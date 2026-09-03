# 小匠工具集

一个简洁的浏览器工具集，目前提供腾讯云 COS 图片上传。

## 本地运行

```bash
npm install
npm run dev
```

打开终端显示的本地地址即可使用。腾讯云凭证只保存在当前浏览器的本地存储中。

## 部署

本项目使用 Vercel 部署。将仓库导入 Vercel 后，Vercel 会自动识别 Next.js，使用 `npm run build` 完成构建。也可以通过 CLI 部署：

```bash
npx vercel --prod
```

## 功能

- 选择、拖拽或粘贴图片上传
- 腾讯云 COS 配置
- 自定义上传目录和访问链接
- 一键复制图片访问链接
- 批量提交腾讯云 CDN URL 刷新任务
