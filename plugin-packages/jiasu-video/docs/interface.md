# 极途 Gway 视频接口

## 接口和鉴权

- 默认 Base URL：`https://www.gway.dev`，可以编辑。
- 创建：`POST /v1/video/generations`，JSON。
- 查询：`GET /v1/videos/tasks/{task_id}`。
- 鉴权：该渠道自己的 `Authorization: Bearer <API Key>`。
- 参考：[极途官方接口文档](https://www.gway.dev/api-docs#video-create)。

## 请求参数

| 字段 | 来源与说明 |
| --- | --- |
| `model` | 原样使用目录中的公开视频模型名，不替换为文档示例 ID，不限制旧名称白名单 |
| `prompt` | 提示词，支持 `@图片N`、`@视频N`、`@音频N` 或 `@素材名称` |
| `duration` | 节点选择的整数秒，使用对应模型实时规格，不强制改写 H3 为 15 秒 |
| `ratio` | 使用对应模型目录提供的比例 |
| `resolution` | 使用对应型号的分辨率，保留节点选择；`minimax-h3` 缺省 `768p`，不强制改写为 `2k` |
| `images` | `[{url,name?,type?}]`；普通参考图省略 type，首帧为 `first_frame`，尾帧为 `end_frame` |
| `videos` | `[{url,name?}]`；不混入其他渠道参数 |
| `audios` | `[{url,name?}]`；不混入其他渠道参数 |
| `face` | 服务端默认时省略；保持原图为 `{enabled:false}`；其余为 `{enabled:true,mode:"light"或"heavy"}` |

不发送旧通道的 `content`、`image_refs`、`video_refs`、`audio_refs`、`first_image`、`last_image`、`native_face`。可选的 `materials` 与三个媒体数组含义重叠，插件统一使用媒体数组，避免重复提交同一素材。

## 模型能力

佳速视频模型按渠道默认同步生成声音。界面显示“同步声音已开启”，已有配置中误存的声音不支持标记自动修正；此接口未公开 `generate_audio` 开关字段，因此请求保持原生字段，由渠道默认生成声音，不混入其他协议参数。

模型配置拉取通过后端读取官方 `api_parameters`，解析该型号的时长、比例、分辨率和各类参考数量，不再将所有 Seedance 2.5 统一覆盖为同一份参数。更新后需重新拉取并保存极途模型配置。官方目录中的规格与真实执行不一致时，应以明确的上游错误为准，不静默删图、变更资产绑定或改动素材编号。

`sd-2.0-mini-J1` 使用同一创建与查询协议，模型 ID 原样提交；本地和插件校验均允许该模型，参考上限为 10 张图片、3 段视频和 3 段音频。

`sd-2.5-j2-V` 与 `sd-2.5-J2` 支持全模态参考：最多 30 张图、10 段视频、10 段音频。佳速 V 版素材总量超过 100 MiB 时，应用会先将参考图片压缩至约原体积一半后上传提交；本地不会按总字节数拦截，若上游明确拒绝素材体积，则压缩图片后自动重试一次。两者时长参数范围为 5–30 秒；V 版分辨率固定为 720p，J2 版提供 480p、720p、1080p。

不同版本的参考上限不能只按模型家族推断。插件不额外套用“SD2.5 一律 30 图、其他一律 10 图”的旧校验；具体能力由目录提供，素材数组原序提交，上游返回的数量限制不伪装成本地参数错误。

`minimax-h3` 缺省为 4–30 秒、768p，提交采用节点选择，不再固定 15 秒、2k，也不套用旧的全部素材合计 10 个规则。参考视频仍须提供真实时长；视频时长校验不代表输出时长。

`dola-sd-2.5` 工作区时长范围为 1–30 秒、默认 5 秒，选择 30 秒时以 `duration: 30` 原样提交；`dola-sd-2.0` 保留 1–15 秒。模型能力由本地目录和接口参数分别约束；实际生成未在此修复中执行。

使用首帧或尾帧时不能同时提交音频，系统会提示调整参考方式，不静默丢弃素材。媒体名称与顺序保持一致。

## 任务与结果

### 本地参考图预处理

仅佳速 `dola-sd-2.5`、`dola-sd-2.0` 在创建任务前执行离线人脸检测。默认使用半透明网格，可在视频节点「人脸遮罩」中切换马赛克或关闭，并逐图调整框。检测失败会要求手动框选或关闭，不静默上传未处理图片；未检出人脸时可手动补框，否则使用原图。

原件与处理副本分开保存；处理副本按用户、原图内容、遮罩样式和区域缓存，重开可复用。预览只在本地运行，开始生成后才保存处理副本并在视频任务中上传图床。失效链接重新上传对应副本，保持图片引用名称和顺序。`videoJiasuFaceMask` 与 `jiasuFaceMasks` 是宿主本地设置，不进入上游 JSON；`images[].url` 为处理后的公网地址。服务端 `face` 选项保持独立。

创建读取 `id`，不拿本地任务 ID 查询上游。状态 `queued` 为等待，`in_progress` 为处理中，`completed` 为成功，`failed` 为失败。完成后从 `result_urls` 读取视频；失败显示 `error.message`。宿主下载并保存生成结果。

## Gway 专属参考素材上传

上传会话的 `items` 按每批 1–20 项提交，`name`、`content_type`、`size`、`kind` 分别填写素材名称、实际 MIME、原文件字节数和 image/video/audio 类型。超过 20 项自动分批，大文件组合按内存占用提前切批；上传批次限制不作为模型参考数量限制。响应逐项对应各自的 `upload_id`、`put.url` 与 `put.headers`，完成确认后才将 URL 写回原位置。

仅 `jiasu-video` 且上游主机为 `gway.dev` 或 `www.gway.dev` 时，宿主使用本渠道 API Key 调用 `POST /v1/media/uploads`，按预签名地址 PUT 原文件，并在 `complete` 成功后使用公开链接。上传会话失败且原文件不超过官方直传上限 32 MiB 时，尝试 `POST /v1/media/upload` 的 `file`、`kind` 表单；专属上传仍不可用才回退 Uguu。取消操作不会触发兜底上传。

此流程不修改原始图片、不改变生成请求参数，不影响其他渠道，也不会把 Gway 密钥转发到预签名对象存储地址。

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "jiasu-video",
  "name": "极途 Gway",
  "version": "1.0.3",
  "author": "Eggfans TV",
  "description": "极途 Gway 独立视频协议，支持 dola-sd-2.5、dola-sd-2.0、minimax-h3、sd-2.5-j2-V、sd-2.5-J2。",
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
        "id": "jiasu-video",
        "label": "极途 Gway",
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
        "baseUrl": "https://ai.jiasuapi.com",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "description": "极途模型目录中的公开视频模型 ID，原样提交，不使用固定名称白名单。",
            "type": "string",
            "required": true,
            "mapping": "model"
          },
          {
            "name": "prompt",
            "description": "视频提示词；@引用名称必须与提交素材 name 对齐。",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "description": "输出时长（整数秒）；按所选模型的实时规格和节点选择提交，不固定 H3 时长。",
            "type": "integer",
            "mapping": "duration"
          },
          {
            "name": "ratio",
            "description": "画面比例：16:9、9:16 或 1:1。",
            "type": "string",
            "mapping": "aspectRatio",
            "values": [
              "16:9",
              "9:16",
              "1:1"
            ]
          },
          {
            "name": "resolution",
            "description": "输出分辨率，按所选模型的实时规格和节点选择提交。",
            "type": "string",
            "mapping": "resolution"
          },
          {
            "name": "images",
            "description": "图片 URL 与可选名称；首尾帧映射到 images[].type 的 first_frame/end_frame。",
            "type": "array",
            "mapping": "images"
          },
          {
            "name": "videos",
            "description": "参考视频 URL 与可选名称，数量以所选模型实时规格为准。",
            "type": "array",
            "mapping": "videos"
          },
          {
            "name": "audios",
            "description": "参考音频 URL 与可选名称，数量以所选模型实时规格为准。",
            "type": "array",
            "mapping": "audios"
          },
          {
            "name": "face",
            "description": "佳速独立人脸处理选项：enabled=false 保持原图，enabled=true 配合 light/heavy，省略采用服务端默认。",
            "type": "object",
            "mapping": "providerOptions.jiasu-video.face"
          }
        ],
        "validations": [
          {
            "assert": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "minimax-h3"
                  ]
                },
                "then": {
                  "$lte": [
                    {
                      "$add": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.videos.0.metadata.durationMs"
                            },
                            0
                          ]
                        },
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.videos.1.metadata.durationMs"
                            },
                            0
                          ]
                        },
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.videos.2.metadata.durationMs"
                            },
                            0
                          ]
                        }
                      ]
                    },
                    15000
                  ]
                },
                "else": true
              }
            },
            "message": "佳速 H3 参考视频总时长不能超过 15 秒"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$concatArrays": [
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
                      "as": "media",
                      "where": {
                        "$in": [
                          {
                            "$first": {
                              "$split": [
                                {
                                  "$ref": "media.url"
                                },
                                "://"
                              ]
                            }
                          },
                          {
                            "$if": {
                              "condition": {
                                "$eq": [
                                  {
                                    "$ref": "request.model"
                                  },
                                  "minimax-h3"
                                ]
                              },
                              "then": [
                                "https"
                              ],
                              "else": [
                                "http",
                                "https"
                              ]
                            }
                          }
                        ]
                      }
                    }
                  }
                },
                {
                  "$add": [
                    {
                      "$len": {
                        "$ref": "request.images"
                      }
                    },
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    }
                  ]
                }
              ]
            },
            "message": "佳速视频只接受公网 URL，H3 素材必须使用 HTTPS"
          },
          {
            "assert": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "minimax-h3"
                  ]
                },
                "then": {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.videos"
                          },
                          "as": "media",
                          "where": {
                            "$gt": [
                              {
                                "$ref": "media.metadata.durationMs"
                              },
                              0
                            ]
                          }
                        }
                      }
                    },
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    }
                  ]
                },
                "else": true
              }
            },
            "message": "佳速 H3 每段参考视频必须提供实际时长"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$in": [
                              {
                                "$ref": "media.role"
                              },
                              [
                                "first_frame",
                                "last_frame"
                              ]
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "佳速首尾帧模式不能同时提交参考音频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
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
                  }
                },
                1
              ]
            },
            "message": "佳速最多只能设置一个首帧"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
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
                  }
                },
                1
              ]
            },
            "message": "佳速最多只能设置一个尾帧"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$len": {
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
                      }
                    },
                    0
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
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
                      }
                    },
                    1
                  ]
                }
              ]
            },
            "message": "佳速使用尾帧时必须设置首帧"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/video/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": {
              "$omitEmpty": {
                "$ref": "request.duration"
              }
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
                {
                  "$if": {
                    "condition": {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "minimax-h3"
                      ]
                    },
                    "then": "768p",
                    "else": {
                      "$if": {
                        "condition": {
                          "$eq": [
                            {
                              "$lower": {
                                "$ref": "request.model"
                              }
                            },
                            "wan3-特惠"
                          ]
                        },
                        "then": "1080p",
                        "else": "720p"
                      }
                    }
                  }
                }
              ]
            },
            "images": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.images"
                  },
                  "as": "media",
                  "in": {
                    "url": {
                      "$ref": "media.url"
                    },
                    "name": {
                      "$omitEmpty": {
                        "$ref": "media.name"
                      }
                    },
                    "type": {
                      "$if": {
                        "condition": {
                          "$eq": [
                            {
                              "$ref": "media.role"
                            },
                            "first_frame"
                          ]
                        },
                        "then": "first_frame",
                        "else": {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "media.role"
                                },
                                "last_frame"
                              ]
                            },
                            "then": "end_frame"
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            "videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.videos"
                  },
                  "as": "media",
                  "in": {
                    "url": {
                      "$ref": "media.url"
                    },
                    "name": {
                      "$omitEmpty": {
                        "$ref": "media.name"
                      }
                    }
                  }
                }
              }
            },
            "audios": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.audios"
                  },
                  "as": "media",
                  "in": {
                    "url": {
                      "$ref": "media.url"
                    },
                    "name": {
                      "$omitEmpty": {
                        "$ref": "media.name"
                      }
                    }
                  }
                }
              }
            },
            "face": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.jiasu-video.face"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/tasks/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.id"
          },
          "status": {
            "$ref": "response.status"
          },
          "message": {
            "$ref": "response.error.message"
          },
          "videos": {
            "$ref": "response.result_urls"
          },
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
