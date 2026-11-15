# 看海视频接口

参考文档：https://yioapp.top/docs/api.html

- Base URL：`https://yioapp.top/openapi/v1`，不是 `/v1`。
- Bearer 鉴权，仅使用该渠道的 API Key。
- `GET /models`：仅保留 `type` 或 `generationType` 为 `video` 的模型；账号实际价格优先，普通/会员价格仅作目录参考。
- `POST /videos`：`model`、`prompt`、`duration`、`ratio`、可选 `resolution` 和 `image_urls` / `video_urls` / `audio_urls`。素材保留原顺序，使用公网链接；本地素材沿用 Uguu 上传。
- `Idempotency-Key` 使用本地任务的稳定提交键；不发送其他渠道的人脸、声音或审核参数。
- `GET /videos/{id}`：始终查询创建时返回的本站任务 ID，不使用 `upstream_task_id` 替代。
- 状态为 `submitting` / `queued` / `running` 时继续查询。`failed` 显示 `failure_reason`。查询或下载异常不重新创建任务。
- 完成后通过 `GET /videos/{id}/content` 携带本站鉴权获取视频。重定向到外部签名 URL 时不携带本站密钥，保留完整签名参数。
- `xianfeng-seedance-2.5` 的音视频参考必须携带真实时长，使用专属 `files` 结构；无音视频时仍可用兼容图片数组。
- 维护和关闭状态标注在模型名后；能力和价格刷新以账号 `/models` 返回为准。

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "kanhai-video",
  "name": "看海视频",
  "version": "1.0.0",
  "author": "Eggfans TV",
  "description": "看海独立视频接口，只使用本站任务 ID 查询和下载。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "看海 API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "kanhai-video",
        "label": "看海视频",
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
        "baseUrl": "https://yioapp.top/openapi/v1",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "description": "看海本站视频模型 ID，按目录原样提交。",
            "type": "string",
            "required": true,
            "mapping": "model"
          },
          {
            "name": "prompt",
            "description": "用户最终确认的视频生成提示词。",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "description": "视频时长，单位为秒，使用当前模型目录支持的值。",
            "type": "integer",
            "required": true,
            "mapping": "duration"
          },
          {
            "name": "ratio",
            "description": "视频宽高比，adaptive 映射为看海的 auto。",
            "type": "string",
            "mapping": "aspectRatio"
          },
          {
            "name": "resolution",
            "description": "当前模型支持的分辨率，未选择时省略。",
            "type": "string",
            "mapping": "resolution"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/videos",
          "contentType": "application/json",
          "headers": {
            "Idempotency-Key": {
              "$ref": "request.extra.idempotencyKey"
            }
          },
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
            "ratio": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "adaptive"
                  ]
                },
                "then": "auto",
                "else": {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "16:9"
                  ]
                }
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
              }
            },
            "image_urls": {
              "$if": {
                "condition": {
                  "$ref": "request.extra.kanhaiFiles"
                },
                "then": {
                  "$omitEmpty": null
                },
                "else": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "in": {
                        "$coalesce": [
                          {
                            "$ref": "media.url"
                          },
                          {
                            "$ref": "media.dataUrl"
                          }
                        ]
                      }
                    }
                  }
                }
              }
            },
            "video_urls": {
              "$if": {
                "condition": {
                  "$ref": "request.extra.kanhaiFiles"
                },
                "then": {
                  "$omitEmpty": null
                },
                "else": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$ref": "request.videos"
                      },
                      "as": "media",
                      "in": {
                        "$coalesce": [
                          {
                            "$ref": "media.url"
                          },
                          {
                            "$ref": "media.dataUrl"
                          }
                        ]
                      }
                    }
                  }
                }
              }
            },
            "audio_urls": {
              "$if": {
                "condition": {
                  "$ref": "request.extra.kanhaiFiles"
                },
                "then": {
                  "$omitEmpty": null
                },
                "else": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$ref": "request.audios"
                      },
                      "as": "media",
                      "in": {
                        "$coalesce": [
                          {
                            "$ref": "media.url"
                          },
                          {
                            "$ref": "media.dataUrl"
                          }
                        ]
                      }
                    }
                  }
                }
              }
            },
            "files": {
              "$omitEmpty": {
                "$ref": "request.extra.kanhaiFiles"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/videos/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/videos/{{taskId}}/content",
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
              "submitting"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.failure_reason"
              },
              {
                "$ref": "response.data.failure_reason"
              },
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
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
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
