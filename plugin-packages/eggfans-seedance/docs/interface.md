# Eggfans Seedance 接口合同

默认 Base URL 为 `https://api.eggfans.com`，鉴权使用 `apiKey` 的 Bearer Token。

| Provider | 创建 | 查询 |
| --- | --- | --- |
| `eggfans-seedance-video` | `POST /api/v3/contents/generations/tasks` | `GET /api/v3/contents/generations/tasks/{id}` |
| `eggfans-volc-video` | `POST /volc/v1/contents/generations/tasks` | `GET /volc/v1/contents/generations/tasks/{task_id}` |

媒体请求保留原生 `content[]`、`image_url`、`video_url`、`audio_url` 对象与 `role`；生成前由宿主完成私域同步，仅提交 Active 资产 URI。列表查询传 `page_size`，经本地管理 API 调用。取消只停止本地轮询，不声明文档未提供的上游删除接口。

## 响应

创建解析 `id` 或 `data.task_id`。轮询保留创建时任务 ID，读取 `status` 或 `data.status`，成功结果从 `content.video_url` 或对应 data 字段取得。业务错误由宿主识别并抛出。

## 完整字段与请求模板

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "eggfans-seedance",
  "name": "Eggfans Seedance 与私域资产",
  "version": "1.0.0",
  "author": "Eggfans TV",
  "description": "Eggfans Seedance 原生 content 视频协议，支持私域 asset:// 图片、视频和音频引用。",
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
        "id": "eggfans-seedance-video",
        "label": "Eggfans Seedance（原生任务）",
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
        "baseUrl": "https://api.eggfans.com",
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
            "description": "Ark endpoint/model ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "content[type=text].text",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=image_url]",
            "description": "first_frame、last_frame、reference_image 等 role 原样映射。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=video_url]",
            "description": "reference_video。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=audio_url]",
            "description": "reference_audio/reference_voice。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "输出画幅。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "输出分辨率档位。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "输出时长秒数。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "generate_audio",
            "description": "是否生成音频。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "required": false,
            "mapping": "watermark",
            "description": "是否带水印。"
          },
          {
            "name": "seed",
            "type": "integer",
            "required": false,
            "mapping": "seed",
            "description": "providerOptions seed。"
          },
          {
            "name": "camera_fixed",
            "type": "boolean",
            "required": false,
            "mapping": "camera_fixed",
            "description": "providerOptions camera_fixed。"
          }
        ],
        "validations": [],
        "create": {
          "method": "POST",
          "path": "/api/v3/contents/generations/tasks",
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
                  "$or": [
                    {
                      "$gt": [
                        {
                          "$ref": "request.duration"
                        },
                        0
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "request.duration"
                        },
                        -1
                      ]
                    }
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
                "$ref": "request.providerOptions.eggfans-seedance-video.seed"
              }
            },
            "camera_fixed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.eggfans-seedance-video.camera_fixed"
              }
            }
          },
          "originPath": true
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
                "$ref": "response.platform_task_id"
              },
              {
                "$ref": "taskId"
              },
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "response.data.task_id"
              },
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.task_id"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$coalesce": [
                      {
                        "$ref": "response.status"
                      },
                      {
                        "$ref": "response.data.status"
                      },
                      "pending"
                    ]
                  },
                  "succeed"
                ]
              },
              "then": "succeeded",
              "else": {
                "$coalesce": [
                  {
                    "$ref": "response.status"
                  },
                  {
                    "$ref": "response.data.status"
                  },
                  "pending"
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
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.content.video_url"
              },
              {
                "$ref": "response.data.content.video_url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.video_url"
              }
            ]
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "eggfans-volc-video",
        "label": "Eggfans Seedance（Volc 任务）",
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
        "baseUrl": "https://api.eggfans.com",
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
            "description": "Ark endpoint/model ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "content[type=text].text",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=image_url]",
            "description": "first_frame、last_frame、reference_image 等 role 原样映射。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=video_url]",
            "description": "reference_video。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=audio_url]",
            "description": "reference_audio/reference_voice。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "输出画幅。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "输出分辨率档位。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "输出时长秒数。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "generate_audio",
            "description": "是否生成音频。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "required": false,
            "mapping": "watermark",
            "description": "是否带水印。"
          },
          {
            "name": "seed",
            "type": "integer",
            "required": false,
            "mapping": "seed",
            "description": "providerOptions seed。"
          },
          {
            "name": "camera_fixed",
            "type": "boolean",
            "required": false,
            "mapping": "camera_fixed",
            "description": "providerOptions camera_fixed。"
          }
        ],
        "validations": [],
        "create": {
          "method": "POST",
          "path": "/volc/v1/contents/generations/tasks",
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
                  "$or": [
                    {
                      "$gt": [
                        {
                          "$ref": "request.duration"
                        },
                        0
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "request.duration"
                        },
                        -1
                      ]
                    }
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
                "$ref": "request.providerOptions.eggfans-volc-video.seed"
              }
            },
            "camera_fixed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.eggfans-volc-video.camera_fixed"
              }
            }
          },
          "originPath": true
        },
        "poll": {
          "method": "GET",
          "path": "/volc/v1/contents/generations/tasks/{{taskId}}",
          "originPath": true
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.platform_task_id"
              },
              {
                "$ref": "taskId"
              },
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "response.data.task_id"
              },
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.task_id"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$coalesce": [
                      {
                        "$ref": "response.status"
                      },
                      {
                        "$ref": "response.data.status"
                      },
                      "pending"
                    ]
                  },
                  "succeed"
                ]
              },
              "then": "succeeded",
              "else": {
                "$coalesce": [
                  {
                    "$ref": "response.status"
                  },
                  {
                    "$ref": "response.data.status"
                  },
                  "pending"
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
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.content.video_url"
              },
              {
                "$ref": "response.data.content.video_url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.video_url"
              }
            ]
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
