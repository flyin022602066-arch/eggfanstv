# EggFans SD2 视频接口

## 接口

- 默认 Base URL：`https://vip.eggfans.asia`
- 创建任务：`POST /v1/videos`
- 查询任务：`GET /v1/videos/{taskId}`
- 鉴权：`Authorization: Bearer <API Key>`
- 支持模型：`sd-2.5-A`、`sd-2.5-B`、`sd-2.5-C`、`sd-2.5-D`、`sd-2.5-E`
- 默认模型：`sd-2.5-C`
- 分辨率：固定 `720p`
- 时长：整数 `4` 至 `30` 秒，含边界

## 创建参数

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | EggFans SD2 模型 ID |
| `prompt` | string | 视频提示词 |
| `duration` | integer | 视频时长，4–30 秒 |
| `resolution` | string | 固定为 `720p` |
| `aspect_ratio` | string | 画幅比例 |
| `image_refs` | string[] | 最多 30 个图片 URL；B、D 模型最多 9 个 |
| `video_refs` | string[] | 最多 10 个视频 URL |
| `audio_refs` | string[] | 最多 10 个音频 URL |
| `first_image` | string | 首帧图片 URL |
| `last_image` | string | 尾帧图片 URL |

首尾帧字段不能与 `image_refs`、`video_refs` 或 `audio_refs` 同时提交。素材 URL 必须是公网 HTTPS 地址。桌面模式下，本地素材会通过 `CANVAS_PUBLIC_BASE_URL` 转换为短时签名地址；该地址需要通过 HTTPS 反向代理访问当前 BeefTV 后端。

## 查询与结果

任务 ID 兼容 `id`、`task_id`、`taskId`。完成后的视频 URL 兼容 `video_url`、`url`、`content.url`、`output.url`。查询页面为 `https://vip.eggfans.work`；应用不会向该网页传递 API Key。

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "eggfans-sd2-video",
  "name": "EggFans SD2 Video",
  "version": "1.0.0",
  "author": "BeefTV Contributors",
  "description": "EggFans SD2 /v1/videos 异步视频生成协议。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "eggfans-sd2-video",
        "label": "EggFans SD2 Video",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://vip.eggfans.asia",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "EggFans SD2 model ID; defaults to sd-2.5-C."
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "Video prompt."
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "duration",
            "description": "Integer from 4 through 30 seconds."
          },
          {
            "name": "resolution",
            "type": "string",
            "required": true,
            "mapping": "resolution",
            "description": "Fixed at 720p."
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "Output aspect ratio."
          },
          {
            "name": "image_refs",
            "type": "string[]",
            "required": false,
            "mapping": "image_refs",
            "description": "HTTPS reference images."
          },
          {
            "name": "video_refs",
            "type": "string[]",
            "required": false,
            "mapping": "video_refs",
            "description": "HTTPS reference videos."
          },
          {
            "name": "audio_refs",
            "type": "string[]",
            "required": false,
            "mapping": "audio_refs",
            "description": "HTTPS reference audio."
          },
          {
            "name": "first_image",
            "type": "string",
            "required": false,
            "mapping": "first_image",
            "description": "HTTPS first-frame image; mutually exclusive with reference media."
          },
          {
            "name": "last_image",
            "type": "string",
            "required": false,
            "mapping": "last_image",
            "description": "HTTPS last-frame image; mutually exclusive with reference media."
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": {
              "$ref": "request.duration"
            },
            "resolution": "720p",
            "aspect_ratio": {
              "$ref": "request.aspectRatio"
            },
            "image_refs": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_image"
                        ]
                      }
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.url"
                  }
                }
              }
            },
            "video_refs": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.videos"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.url"
                  }
                }
              }
            },
            "audio_refs": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.audios"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.url"
                  }
                }
              }
            },
            "first_image": {
              "$omitEmpty": {
                "$first": {
                  "$map": {
                    "from": {
                      "$filter": {
                        "from": {
                          "$ref": "request.images"
                        },
                        "as": "media",
                        "where": {
                          "$eq": [
                            {
                              "$ref": "media.role"
                            },
                            "first_frame"
                          ]
                        }
                      }
                    },
                    "as": "media",
                    "in": {
                      "$ref": "media.url"
                    }
                  }
                }
              }
            },
            "last_image": {
              "$omitEmpty": {
                "$first": {
                  "$map": {
                    "from": {
                      "$filter": {
                        "from": {
                          "$ref": "request.images"
                        },
                        "as": "media",
                        "where": {
                          "$eq": [
                            {
                              "$ref": "media.role"
                            },
                            "last_frame"
                          ]
                        }
                      }
                    },
                    "as": "media",
                    "in": {
                      "$ref": "media.url"
                    }
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "response.data.task_id"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.state"
              },
              {
                "$ref": "response.data.status"
              },
              "pending"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.detail"
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.content.url"
              },
              {
                "$ref": "response.output.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.data.url"
              }
            ]
          },
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
