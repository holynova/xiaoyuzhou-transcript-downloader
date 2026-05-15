# Xiaoyuzhou Transcript Downloader

一个基于 `opencli` 的小宇宙播客节目清单与 transcript 批量下载脚本。

它可以：

- 输入小宇宙播客名称、主页 URL 或播客 ID
- 检查 `opencli`、`opencli doctor` 和 `opencli xiaoyuzhou`
- 检查并引导生成 `~/.opencli/xiaoyuzhou.json`
- 拉取播客完整节目清单，不止网页首屏的 15 条
- 选择是否批量下载每期 transcript JSON
- 支持随机等待、失败重试、跳过已存在文件和断点状态记录

## Requirements

- Node.js 18+
- [`opencli`](https://github.com/jackwener/opencli)
- 已登录或已配置小宇宙 auth

检查本机环境：

```bash
opencli --help
opencli doctor
opencli xiaoyuzhou --help
```

## Install

克隆仓库后直接运行脚本即可：

```bash
git clone https://github.com/holynova/xiaoyuzhou-transcript-downloader.git
cd xiaoyuzhou-transcript-downloader
node xiaoyuzhou-podcast-transcripts.mjs --help
```

也可以加执行权限后直接运行：

```bash
chmod +x xiaoyuzhou-podcast-transcripts.mjs
./xiaoyuzhou-podcast-transcripts.mjs --help
```

## Auth

脚本会读取：

```text
~/.opencli/xiaoyuzhou.json
```

格式如下：

```json
{
  "access_token": "x-jike-access-token",
  "refresh_token": "x-jike-refresh-token",
  "device_id": "your-device-id",
  "device_properties": ""
}
```

如果文件不存在，脚本会提示你粘贴浏览器或抓包得到的 curl / headers / cookie，并自动提取：

- `x-jike-access-token`
- `x-jike-refresh-token`
- `x-jike-device-id`
- `x-jike-device-properties`

其中 `device_id` 和 `device_properties` 是可选字段。不要把 token 提交到 GitHub。

## Usage

交互式运行：

```bash
node xiaoyuzhou-podcast-transcripts.mjs
```

用播客名称搜索并下载：

```bash
node xiaoyuzhou-podcast-transcripts.mjs --podcast "半拿铁" --download
```

用播客主页 URL：

```bash
node xiaoyuzhou-podcast-transcripts.mjs \
  --podcast "https://www.xiaoyuzhoufm.com/podcast/62382c1103bea1ebfffa1c00" \
  --download
```

用播客 ID：

```bash
node xiaoyuzhou-podcast-transcripts.mjs \
  --podcast 62382c1103bea1ebfffa1c00 \
  --download
```

只拉取节目清单，不下载 transcript：

```bash
node xiaoyuzhou-podcast-transcripts.mjs \
  --podcast 62382c1103bea1ebfffa1c00 \
  --yes
```

调慢下载间隔：

```bash
node xiaoyuzhou-podcast-transcripts.mjs \
  --podcast "半拿铁" \
  --download \
  --min-delay-ms 15000 \
  --max-delay-ms 45000
```

只下载一部分，适合测试或续跑：

```bash
node xiaoyuzhou-podcast-transcripts.mjs \
  --podcast 62382c1103bea1ebfffa1c00 \
  --download \
  --start 50 \
  --limit 10
```

## Output

默认输出到：

```text
./xiaoyuzhou-output/
```

目录结构：

```text
xiaoyuzhou-output/
  <podcast-title>-<podcast-id>/
    podcast.json
    episodes.json
    run-state.json
    failed.json
    transcripts/
      <episode-id>/
        transcript.json
```

说明：

- `podcast.json`：播客基本信息
- `episodes.json`：完整节目清单
- `run-state.json`：下载状态，可用于检查成功、跳过和失败项
- `failed.json`：失败节目列表
- `transcripts/<episode-id>/transcript.json`：单期 transcript JSON

## Options

```text
--podcast <value>       小宇宙播客名称、主页 URL 或 24 位播客 ID
--download              拉取节目清单后直接下载所有 transcript
--yes                   非交互确认；不会自动触发下载，仍需 --download
--output <dir>          输出根目录，默认 ./xiaoyuzhou-output
--min-delay-ms <n>      下载间隔下限，默认 8000
--max-delay-ms <n>      下载间隔上限，默认 22000
--retries <n>           单期失败重试次数，默认 2
--start <n>             从第 n 条开始下载，默认 0
--limit <n>             只下载 n 条，默认 0 表示全部
```

## Notes

- 节目清单通过小宇宙 API 的 `loadMoreKey` 翻页获取。
- transcript 下载通过 `opencli xiaoyuzhou transcript` 完成。
- 某些节目本身可能没有 transcript URL，脚本会记录失败并继续处理其它节目。
- 请只下载你有权访问和使用的内容，并遵守小宇宙及播客内容方的相关条款。
