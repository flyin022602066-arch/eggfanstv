# Towo SD2.5 Video API

## 协议

| 项目 | 值 |
| --- | --- |
| Provider ID | `towo-sd25-video` |
| Base URL | `https://towoapi.com` |
| 创建 | `POST /v1/videos` |
| 查询 | `GET /v1/videos/{id}` |
| 下载 | `GET /v1/videos/{id}/content` |
| 鉴权 | `Authorization: Bearer <token>` |

## 请求字段

| 字段 | 统一来源 | 说明 |
| --- | --- | --- |
| `model` | `request.model` | 默认模型 ID 为 `seedance-2.5`，按模型目录原样传输。 |
| `prompt` | `request.prompt` | 视频提示词。 |
| `seconds` | `request.duration` | 4 到 30 秒。 |
| `resolution` | `request.resolution` | `480p`、`720p` 或 `1080p`。 |
| `aspect_ratio` | `request.aspectRatio` | `16:9`、`9:16`、`4:3`、`3:4`、`1:1`、`21:9` 或 `adaptive`。 |
| `enable_audio` | `request.generateAudio` | 布尔值，默认开启。 |
| `reference_images` | `request.images` | `{ "image_url": "..." }` 数组，最多 30 张普通参考图。 |
| `reference_videos` | `request.videos` | `{ "video_url": "..." }` 数组，最多 10 段。 |
| `reference_audios` | `request.audios` | `{ "audio_url": "..." }` 数组，最多 10 段。 |
| `first_frame` | 首帧图片 | `{ "image_url": "..." }`，与 `last_frame` 独立映射。 |
| `last_frame` | 尾帧图片 | `{ "image_url": "..." }`，与 `first_frame` 独立映射。 |

不会发送佳速的 `duration`、`ratio`、`images`、`videos`、`audios`、`face` 或 `native_face` 字段，也不会把 Towo 请求落到其他渠道的协议适配器。

## 响应与结果

创建响应中的 `id` 是上游任务 ID。轮询响应状态为 `queued`、`in_progress`、`completed` 或 `failed` 时，分别映射到本地任务状态。任务完成后使用 `GET /v1/videos/{id}/content`，携带相同 Bearer Token 下载 MP4；不依赖轮询响应中的临时 URL。

## 参考素材

本地图片、视频和音频由宿主的公网资源准备流程上传并校验链接。失效链接按现有资源准备逻辑重新上传后再进入 Towo 请求；插件本身不接触本地文件、不保存密钥，也不调用佳速的人脸处理参数。

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "towo-sd25-video",
  "name": "Towo SD2.5",
  "version": "1.0.0",
  "author": "Eggfans TV",
  "description": "Towo SD2.5 独立视频协议，使用 /v1/videos 创建、查询和认证内容下载。",
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
        "id": "towo-sd25-video",
        "label": "Towo SD2.5",
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
        "baseUrl": "https://towoapi.com",
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
            "description": "Towo 视频模型 ID，默认使用 seedance-2.5。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "seconds",
            "type": "integer",
            "required": true,
            "mapping": "duration",
            "description": "视频时长，支持 4 到 30 秒。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": true,
            "mapping": "resolution",
            "values": [
              "480p",
              "720p",
              "1080p"
            ],
            "description": "输出分辨率。"
          },
          {
            "name": "aspect_ratio",
            "type": "string",
            "required": true,
            "mapping": "aspectRatio",
            "values": [
              "16:9",
              "9:16",
              "4:3",
              "3:4",
              "1:1",
              "21:9",
              "adaptive"
            ],
            "description": "输出画幅比例。"
          },
          {
            "name": "enable_audio",
            "type": "boolean",
            "required": false,
            "mapping": "generateAudio",
            "description": "是否生成声音，默认 true。"
          },
          {
            "name": "reference_images",
            "type": "media[]",
            "required": false,
            "mapping": "request.images",
            "description": "普通参考图片，最多 30 张。"
          },
          {
            "name": "reference_videos",
            "type": "media[]",
            "required": false,
            "mapping": "request.videos",
            "description": "参考视频，最多 10 段。"
          },
          {
            "name": "reference_audios",
            "type": "media[]",
            "required": false,
            "mapping": "request.audios",
            "description": "参考音频，最多 10 段。"
          },
          {
            "name": "first_frame",
            "type": "media",
            "required": false,
            "mapping": "request.images[first_frame]",
            "description": "首帧图片。"
          },
          {
            "name": "last_frame",
            "type": "media",
            "required": false,
            "mapping": "request.images[last_frame]",
            "description": "尾帧图片。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$gte": [
                {
                  "$ref": "request.duration"
                },
                4
              ]
            },
            "message": "Towo 视频时长不能少于 4 秒"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$ref": "request.duration"
                },
                30
              ]
            },
            "message": "Towo 视频时长不能超过 30 秒"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                30
              ]
            },
            "message": "Towo 最多支持 30 张参考图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                10
              ]
            },
            "message": "Towo 最多支持 10 段参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                10
              ]
            },
            "message": "Towo 最多支持 10 段参考音频"
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
            "seconds": {
              "$ref": "request.duration"
            },
            "resolution": {
              "$coalesce": [
                {
                  "$ref": "request.resolution"
                },
                "720p"
              ]
            },
            "aspect_ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
            },
            "enable_audio": {
              "$ref": "request.generateAudio"
            },
            "reference_images": {
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
                    "image_url": {
                      "$ref": "media.url"
                    }
                  }
                }
              }
            },
            "reference_videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.videos"
                  },
                  "as": "media",
                  "in": {
                    "video_url": {
                      "$ref": "media.url"
                    }
                  }
                }
              }
            },
            "reference_audios": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.audios"
                  },
                  "as": "media",
                  "in": {
                    "audio_url": {
                      "$ref": "media.url"
                    }
                  }
                }
              }
            },
            "first_frame": {
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
                      "image_url": {
                        "$ref": "media.url"
                      }
                    }
                  }
                }
              }
            },
            "last_frame": {
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
                      "image_url": {
                        "$ref": "media.url"
                      }
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
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
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
                "$ref": "response.data.id"
              },
              {
                "$ref": "response.data.task_id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.data.status"
              },
              "queued"
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
                "$ref": "response.error"
              }
            ]
          },
          "errorPaths": [
            "error.code",
            "response.error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
