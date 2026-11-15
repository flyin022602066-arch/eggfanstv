# nono 视频接口

参考文档：https://sub-tz.top/developer/docs

- Base URL：`https://sub-tz.top/prod-api/v1`，鉴权 `Authorization: Bearer <API Key>`。文档实际 cURL 使用 `/prod-api/v1` 前缀。
- 创建：`POST /videos`，查询：`GET /videos/{task_id}`；使用本站返回的 `id` 或 `task_id`。
- 请求：`model` 使用目录完整中文编码；`spec: "720p"`、`count: 1`、`prompt`，以及 `params.duration`、`params.ratio`、`params.resolution`。
- 素材用途：有任何图片、视频或音频参考时发送 `reference_mode: "omni"`，无参考素材时发送 `reference_mode: "text"`。这是文档声明的 `params.referenceMode` 顶层写法，仅发送一处，避免有图请求按文生视频用途校验数量。
- `image_urls`、`video_urls`、`audio_urls` 是公网直链字符串数组；本地素材通过现有 Uguu 上传流程转换，保持素材顺序。上游会下载并保存参考素材。
- 不传其他渠道的 `face`、`native_face`、`seconds`、`generate_audio`、`reference_images`，不调用 Token 计费模型的报价接口。
- 默认有声视频，不添加本地静音限制；`generateAudio` 能力用于展示和保留默认声音，不转换成接口未支持的参数。
- 满血版：5～30秒，最多30图/10视频/10音频。福利版：5～30秒，最多20图/5视频/5音频。仅参考图版：固定30秒，最多9图。
- 上述能力供界面展示和参数建议使用；nono 请求不按本地目录或旧配置拦截素材数量、体积、时长、分辨率或提示词，不删减引用，不截断文本。是否支持由上游实际响应判定，失败保留上游原始说明。
- 公开目录参考价分别为5.5、4.8、3.5积分/条；刷新目录后以返回价格为准，不标注为人民币。不自行承诺真人支持。
- `queued`、`in_progress` 为处理中；`completed`、带结果的 `partial_success` 为完成；`failed`、`canceled` 为终态。结果来自 `results[].url`，失败原因来自 `error.message`。
- 提交后保存原任务ID；断线恢复查询原任务，不因查询或下载异常重复提交付费生成。

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "nono-video",
  "name": "nono Seedance 2.5",
  "version": "1.0.2",
  "author": "Eggfans TV",
  "description": "nono 独立视频接口，仅接入指定的三个按条 Seedance 2.5 模型。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "nono API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "nono-video",
        "label": "nono Seedance 2.5",
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
        "baseUrl": "https://sub-tz.top/prod-api/v1",
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
            "description": "文档中的完整中文模型编码，保留大小写和空格。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "用户最终确认的生成提示词。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "params.duration",
            "description": "视频秒数，按当前模型目录配置提交。"
          },
          {
            "name": "ratio",
            "type": "string",
            "mapping": "params.ratio",
            "description": "视频比例，仅使用模型目录允许值。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "params.resolution",
            "description": "这三个模型使用720p规格。"
          },
          {
            "name": "referenceMode",
            "type": "string",
            "mapping": "reference_mode",
            "description": "有图片、视频或音频参考时使用omni；没有参考素材时使用text。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "spec": "720p",
            "prompt": {
              "$ref": "request.prompt"
            },
            "count": 1,
            "reference_mode": {
              "$if": {
                "condition": {
                  "$or": [
                    {
                      "$ref": "request.images"
                    },
                    {
                      "$ref": "request.videos"
                    },
                    {
                      "$ref": "request.audios"
                    }
                  ]
                },
                "then": "omni",
                "else": "text"
              }
            },
            "params": {
              "duration": {
                "$ref": "request.duration"
              },
              "ratio": {
                "$coalesce": [
                  {
                    "$ref": "request.aspectRatio"
                  },
                  "16:9"
                ]
              },
              "resolution": "720p"
            },
            "image_urls": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.images"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.url"
                  }
                }
              }
            },
            "video_urls": {
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
            "audio_urls": {
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
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/videos/{{taskId}}"
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
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$ref": "response.status"
                  },
                  "partial_success"
                ]
              },
              "then": "completed",
              "else": {
                "$coalesce": [
                  {
                    "$ref": "response.status"
                  },
                  "queued"
                ]
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "videos": {
            "$map": {
              "from": {
                "$ref": "response.results"
              },
              "as": "result",
              "in": {
                "$ref": "result.url"
              }
            }
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
