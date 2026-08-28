const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(key: string | ArrayBuffer, value: string) {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secretId?: string; secretKey?: string; values?: string[]; mode?: "url" | "path"; flushType?: "flush" | "delete" };
    const secretId = body.secretId?.trim();
    const secretKey = body.secretKey?.trim();
    const mode = body.mode === "path" ? "path" : "url";
    const values = Array.isArray(body.values) ? [...new Set(body.values.map(value => value.trim()).filter(Boolean))] : [];
    const limit = mode === "url" ? 1000 : 500;
    if (!secretId || !secretKey) return Response.json({ error: "缺少腾讯云认证信息" }, { status: 400 });
    if (!values.length || values.length > limit) return Response.json({ error: `刷新数量需要在 1 到 ${limit} 之间` }, { status: 400 });
    for (const value of values) {
      try { const url = new URL(value); if (!/^https?:$/.test(url.protocol)) throw new Error(); }
      catch { return Response.json({ error: `URL 格式不正确：${value}` }, { status: 400 }); }
    }

    const service = "cdn";
    const host = "cdn.tencentcloudapi.com";
    const action = mode === "url" ? "PurgeUrlsCache" : "PurgePathCache";
    const version = "2018-06-06";
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const payload = JSON.stringify(mode === "url" ? { Urls: values } : { Paths: values, FlushType: body.flushType === "delete" ? "delete" : "flush" });
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
    const signedHeaders = "content-type;host";
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256(payload)}`;
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${await sha256(canonicalRequest)}`;
    const secretDate = await hmac(`TC3${secretKey}`, date);
    const secretService = await hmac(secretDate, service);
    const secretSigning = await hmac(secretService, "tc3_request");
    const signature = hex(await hmac(secretSigning, stringToSign));
    const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(`https://${host}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json; charset=utf-8",
        Host: host,
        "X-TC-Action": action,
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Version": version,
      },
      body: payload,
    });
    const result = await response.json() as { Response?: { Error?: { Code?: string; Message?: string }; TaskId?: string; RequestId?: string } };
    if (!response.ok || result.Response?.Error) {
      const error = result.Response?.Error;
      return Response.json({ error: error?.Message || error?.Code || "腾讯云接口请求失败" }, { status: 502 });
    }
    return Response.json({ taskId: result.Response?.TaskId, requestId: result.Response?.RequestId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "刷新请求失败" }, { status: 500 });
  }
}
