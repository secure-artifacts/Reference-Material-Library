# 素材参考库 (Reference Material Library)

本地优先的素材/链接参考资料库：分类管理、九宫格排版预览、截图画廊、Facebook/YouTube 链接解析与本地硬盘直读直写。

浏览器扩展，Manifest V3。

## 安装方式

1. 下载 [Releases](../../releases) 页面中最新版本的 zip 文件并解压
2. 打开 Chrome，访问 `chrome://extensions`
3. 打开右上角"开发者模式"
4. 点击"加载已解压的扩展程序"，选择解压后的文件夹

## 如何发布新版本

本项目使用 GitHub Actions 自动构建和发布。每次发布新版本只需要创建一个 Git Tag 并推送即可。

### 发布步骤

#### 1. 确保代码已提交并推送

在发布之前，确保你的所有代码改动已经提交并推送到 GitHub：

```bash
# 查看当前状态
git status

# 添加所有改动
git add .

# 提交改动（把"你的改动说明"替换成实际的描述）
git commit -m "你的改动说明"

# 推送到 GitHub
git push origin main
```

#### 2. 创建版本 Tag

Git Tag 是一个版本标记，用于标识发布的版本号。版本号格式为 `v主版本.次版本.修订版本`，例如 `v1.2.0`、`v1.3.0`、`v2.0.0`。

同时记得把 `manifest.json` 里的 `"version"` 字段也同步改成新版本号（不带 `v` 前缀），否则扩展本身显示的版本号和 Release 版本号会对不上。

```bash
# 创建一个新的版本 tag（将 v1.2.0 替换为你想要的版本号）
git tag -a v1.2.0 -m "Release version 1.2.0"
```

#### 3. 推送 Tag 触发自动构建

```bash
# 推送 tag 到 GitHub（这会自动触发 CI 构建）
git push origin v1.2.0
```

推送后，GitHub Actions 会自动执行以下操作：
1. 把扩展打包成 zip
2. 生成安全签名（Attestation）
3. 创建 Release 并上传构建产物

#### 4. 查看构建结果

- 构建进度：访问项目的 **Actions** 页面查看
- 发布结果：访问项目的 **Releases** 页面查看已发布的文件

### 版本号说明

| 版本号格式 | 什么时候用 | 示例 |
|-----------|-----------|------|
| `vX.0.0` | 重大更新、不兼容改动 | `v2.0.0` |
| `vX.Y.0` | 新增功能 | `v1.3.0` |
| `vX.Y.Z` | 修复 bug | `v1.2.1` |

### 如果构建失败怎么办

1. 访问项目的 **Actions** 页面查看错误日志
2. 修复代码问题
3. 删除失败的 tag 并重新创建：

```bash
# 删除本地 tag
git tag -d v1.2.0

# 删除远程 tag
git push origin :refs/tags/v1.2.0

# 修复问题后，重新创建并推送
git tag -a v1.2.0 -m "Release version 1.2.0"
git push origin v1.2.0
```

## 应用内自动更新检测

`main.js` 中的 `GITHUB_REPO` 常量指向本仓库，扩展启动时会自动请求
`https://api.github.com/repos/secure-artifacts/Reference-Material-Library/releases`
检查是否有新版本，如果 Release 的 tag 版本号比本地 `APP_VERSION` 新，会弹出更新提示。
