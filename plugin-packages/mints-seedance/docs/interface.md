# Mints 接口合同

文档 Base URL 为 `http://open.mints-id.com`，鉴权为 `Authorization: Bearer <平台 Key>`。如平台提供 HTTPS 地址，可在渠道配置中修改。不可使用其他渠道的 Key 或 URI。

## 自动参考素材

1. 视频任务创建阶段读取本地素材，检测已缓存 Uguu 链接的有效期和可访问性，失效时上传原始文件并更新链接。
2. `POST /api/seedance/assets`，JSON 使用 `URL`、`AssetType`（Image/Video/Audio）、`Name`，可选 `GroupId`。未指定组时使用平台默认组，不额外调用其他平台的分组接口，不设置 Force。
3. 保存 `Result.Id`，每 3 秒 `GET /api/seedance/assets/{Id}`。只有 `Result.Status=Active` 可生成 `asset://{Id}`；Processing 会等待，Failed 会停止视频提交。中断后继续查询已保存 ID。
4. 将绑定保存到本地资源记录关联表。再次使用先核对平台状态，已失效/删除的资产重新绑定，其他渠道不读取这些 URI。原图仍用于预览和其他渠道。

`asset_group_id` 可通过本渠道 providerOptions 指定已认证组。真人素材需用户在平台自行完成 H5 身份认证，自动素材上传不代替认证。

## 视频

`POST /api/v3/contents/generations/tasks`：`model`、`content[]`、`resolution`、`ratio`、`duration`（整数秒）、`generate_audio`、`watermark`。可选 `seed`、`service_tier`、`camera_fixed`、`draft` 从本渠道 providerOptions 读取。

文本保持 `{type:"text",text:...}`；媒体保持 `{type:"image_url",image_url:{url:"asset://..."},role:"reference_image"}`，视频/音频对应 `video_url`/`audio_url` 对象和 `reference_video`/`reference_audio`。图片首尾帧角色保持不变，`@图片1` 等顺序不变。

创建返回 `id`，轮询 `GET /api/v3/contents/generations/tasks/{id}`，只有 succeeded 才读取 `content.video_url`，失败显示平台错误；成功立即按媒体类型下载到本地。恢复任务沿用创建时 ID，不重新生成。视频 URL 有效 24 小时，Seedance 2.5 下载上限为 100 次。

文档支持列表中的准确模型 ID 为 `doubao-seedance-2-0-260128`、`doubao-seedance-2-0-fast-260128`；另一个文档还列出 `doubao-seedance-2-0-mini-260615`。2.5 的准确 ID 须由平台确认，可手动修改，不将其他渠道的 ID 当作此平台已支持模型。

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "mints-seedance",
  "name": "Mints Seedance 自动资产绑定",
  "version": "1.0.0",
  "author": "Eggfans TV",
  "description": "独立的 Mints Seedance 原生视频渠道，由宿主自动上传 Uguu、绑定平台资产并等待 Active。",
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
        "label": "Mints API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "mints-seedance-video",
        "label": "Mints Seedance（自动 URI）",
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
        "baseUrl": "http://open.mints-id.com",
        "requiresPublicMediaUrls": false,
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
            "description": "平台提供的准确模型 ID，可在模型配置中修改。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "content[type=text].text",
            "description": "提示词，保持 @参考序号。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "content[type=image_url]",
            "description": "就绪的图片 URI，保留首尾帧或参考图角色。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "content[type=video_url]",
            "description": "就绪的视频 URI。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "content[type=audio_url]",
            "description": "就绪的音频 URI。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "ratio",
            "description": "输出宽高比。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "description": "输出分辨率。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "输出时长，整数秒。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "mapping": "generate_audio",
            "description": "生成声音。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "mapping": "watermark",
            "description": "输出水印。"
          },
          {
            "name": "seed",
            "type": "integer",
            "mapping": "seed",
            "description": "本渠道专属随机种子。"
          },
          {
            "name": "camera_fixed",
            "type": "boolean",
            "mapping": "camera_fixed",
            "description": "固定镜头。"
          },
          {
            "name": "draft",
            "type": "boolean",
            "mapping": "draft",
            "description": "草稿模式。"
          },
          {
            "name": "service_tier",
            "type": "string",
            "mapping": "service_tier",
            "description": "default 或 flex 服务等级。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v3/contents/generations/tasks",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "content": {
              "$concatArrays": [
                [
                  {
                    "type": "text",
                    "text": {
                      "$ref": "request.prompt"
                    }
                  }
                ],
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "image_url",
                      "image_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_image"
                        ]
                      }
                    }
                  }
                },
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.videos"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "video_url",
                      "video_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_video"
                        ]
                      }
                    }
                  }
                },
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.audios"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "audio_url",
                      "audio_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_audio"
                        ]
                      }
                    }
                  }
                }
              ]
            },
            "ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
            },
            "resolution": {
              "$coalesce": [
                {
                  "$ref": "request.resolution"
                },
                "720p"
              ]
            },
            "duration": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.duration"
                },
                "else": 5
              }
            },
            "generate_audio": {
              "$ref": "request.generateAudio"
            },
            "watermark": {
              "$ref": "request.watermark"
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.mints-seedance-video.seed"
              }
            },
            "camera_fixed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.mints-seedance-video.camera_fixed"
              }
            },
            "draft": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.mints-seedance-video.draft"
              }
            },
            "service_tier": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.mints-seedance-video.service_tier"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/v3/contents/generations/tasks/{{taskId}}",
          "originPath": true
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "taskId"
              },
              {
                "$ref": "response.id"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
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
              }
            ]
          },
          "videos": {
            "$ref": "response.content.video_url"
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
