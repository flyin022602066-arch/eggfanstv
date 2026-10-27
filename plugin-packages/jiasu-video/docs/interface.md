# 佳速视频接口

## 接口和鉴权

- 默认 Base URL：`https://ai.jiasuapi.com`，可以编辑。
- 创建：`POST /v1/video/generations`，JSON。
- 查询：`GET /v1/videos/tasks/{task_id}`。
- 鉴权：该渠道自己的 `Authorization: Bearer <API Key>`。
- 参考：[创建视频](https://aijiasu.apifox.cn/api-510583244)、[查询视频](https://aijiasu.apifox.cn/api-511071739)、[H3 专用说明](https://aijiasu.apifox.cn/api-520050937)。

## 请求参数

| 字段 | 来源与说明 |
| --- | --- |
| `model` | 原样使用 `dola-sd-2.5`、`dola-sd-2.0`、`minimax-h3`、`sd-2.5-j2-V`、`sd-2.5-J2`、`sd-2.0-mini-J1`；不替换为文档示例的模型 ID |
| `prompt` | 提示词，支持 `@图片N`、`@视频N`、`@音频N` 或 `@素材名称` |
| `duration` | 节点时长（秒）；H3 按专用文档固定提交 15 |
| `ratio` | `16:9`、`9:16`、`1:1` |
| `resolution` | Dola/J2 为 `480p`、`720p`、`1080p`；J2-V 固定 `720p`；H3 固定 `2k` |
| `images` | `[{url,name?,type?}]`；普通参考图省略 type，首帧为 `first_frame`，尾帧为 `end_frame` |
| `videos` | `[{url,name?}]`；J2/J2-V 最多 10 段；H3 额外提交实际 `duration_seconds`（毫秒元数据除以 1000），可带 `mime` |
| `audios` | `[{url,name?}]`；J2/J2-V 最多 10 段；H3 可带 `mime` |
| `face` | 服务端默认时省略；保持原图为 `{enabled:false}`；其余为 `{enabled:true,mode:"light"或"heavy"}` |

不发送旧通道的 `content`、`image_refs`、`video_refs`、`audio_refs`、`first_image`、`last_image`、`native_face`。可选的 `materials` 与三个媒体数组含义重叠，插件统一使用媒体数组，避免重复提交同一素材。

## 模型能力

佳速视频模型按渠道默认同步生成声音。界面显示“同步声音已开启”，已有配置中误存的声音不支持标记自动修正；此接口未公开 `generate_audio` 开关字段，因此请求保持原生字段，由渠道默认生成声音，不混入其他协议参数。

`sd-2.0-mini-J1` 使用同一创建与查询协议，模型 ID 原样提交；本地和插件校验均允许该模型，参考上限为 10 张图片、3 段视频和 3 段音频。

`sd-2.5-j2-V` 与 `sd-2.5-J2` 支持全模态参考：最多 30 张图、10 段视频、10 段音频。佳速 V 版素材总量超过 100 MiB 时，应用会先将参考图片压缩至约原体积一半后上传提交；本地不会按总字节数拦截，若上游明确拒绝素材体积，则压缩图片后自动重试一次。两者时长参数范围为 5–30 秒；V 版分辨率固定为 720p，J2 版提供 480p、720p、1080p。

模型名称含 SD2.5（包含 `sd-2.5`、`seedance-2.5` 等写法）的参考图上限统一为 30 张；其他视频模型至少支持 10 张参考图。`dola-sd-2.5` 参考音频为 10 段；各模型的视频、音频数量限制分别校验。

H3 专用文档规定：输出 15 秒、2k，最多 3 段参考视频、3 段参考音频，图片/视频/音频合计最多 10 个；视频必须有真实时长，合计不超过 15 秒。缺少时长或超限时本地拒绝提交。

`dola-sd-2.5` 工作区时长范围为 1–30 秒、默认 5 秒，选择 30 秒时以 `duration: 30` 原样提交；`dola-sd-2.0` 保留 1–15 秒。模型能力由本地目录和接口参数分别约束；实际生成未在此修复中执行。

使用首帧或尾帧时不能同时提交音频，系统会提示调整参考方式，不静默丢弃素材。媒体名称与顺序保持一致。

## 任务与结果

### 本地参考图预处理

仅佳速 `dola-sd-2.5`、`dola-sd-2.0` 在创建任务前执行离线人脸检测。默认使用半透明网格，可在视频节点「人脸遮罩」中切换马赛克或关闭，并逐图调整框。检测失败会要求手动框选或关闭，不静默上传未处理图片；未检出人脸时可手动补框，否则使用原图。

原件与处理副本分开保存；处理副本按用户、原图内容、遮罩样式和区域缓存，重开可复用。预览只在本地运行，开始生成后才保存处理副本并在视频任务中上传图床。失效链接重新上传对应副本，保持图片引用名称和顺序。`videoJiasuFaceMask` 与 `jiasuFaceMasks` 是宿主本地设置，不进入上游 JSON；`images[].url` 为处理后的公网地址。服务端 `face` 选项保持独立。

创建读取 `id`，不拿本地任务 ID 查询上游。状态 `queued` 为等待，`in_progress` 为处理中，`completed` 为成功，`failed` 为失败。完成后从 `result_urls` 读取视频；失败显示 `error.message`。宿主下载并保存生成结果。

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "jiasu-video",
  "name": "佳速视频",
  "version": "1.0.1",
  "author": "Eggfans TV",
  "description": "佳速独立视频协议，支持 dola-sd-2.5、dola-sd-2.0、minimax-h3、sd-2.5-j2-V、sd-2.5-J2。",
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
        "label": "佳速视频",
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
            "description": "佳速视频模型 ID：dola-sd-2.5、dola-sd-2.0、minimax-h3、sd-2.5-j2-V 或 sd-2.5-J2，按模型目录原样提交。",
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
            "description": "输出时长（秒）；dola 未传采用模型默认值，H3 固定 15 秒。",
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
            "description": "dola 为 480p、720p 或 1080p；H3 固定 2k。",
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
            "description": "视频 URL 与可选名称；J2/J2-V 最多 10 段参考视频；H3 每项需携带实际 duration_seconds，总计不超过 15 秒。",
            "type": "array",
            "mapping": "videos"
          },
          {
            "name": "audios",
            "description": "音频 URL 与可选名称；J2/J2-V 最多 10 段参考音频；不能与图片首尾帧同时使用。",
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
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                {
                  "$if": {
                    "condition": {
                      "$or": [
                        {
                          "$gt": [
                            {
                              "$len": {
                                "$split": [
                                  {
                                    "$lower": {
                                      "$ref": "request.model"
                                    }
                                  },
                                  "sd2.5"
                                ]
                              }
                            },
                            1
                          ]
                        },
                        {
                          "$gt": [
                            {
                              "$len": {
                                "$split": [
                                  {
                                    "$lower": {
                                      "$ref": "request.model"
                                    }
                                  },
                                  "sd-2.5"
                                ]
                              }
                            },
                            1
                          ]
                        },
                        {
                          "$gt": [
                            {
                              "$len": {
                                "$split": [
                                  {
                                    "$lower": {
                                      "$ref": "request.model"
                                    }
                                  },
                                  "seedance-2.5"
                                ]
                              }
                            },
                            1
                          ]
                        },
                        {
                          "$gt": [
                            {
                              "$len": {
                                "$split": [
                                  {
                                    "$lower": {
                                      "$ref": "request.model"
                                    }
                                  },
                                  "seedance-2-5"
                                ]
                              }
                            },
                            1
                          ]
                        },
                        {
                          "$gt": [
                            {
                              "$len": {
                                "$split": [
                                  {
                                    "$lower": {
                                      "$ref": "request.model"
                                    }
                                  },
                                  "seedance2.5"
                                ]
                              }
                            },
                            1
                          ]
                        }
                      ]
                    },
                    "then": 30,
                    "else": 10
                  }
                }
              ]
            },
            "message": "佳速参考图片超过模型限制（SD2.5 为 30 张，其余为 10 张）"
          },
          {
            "assert": {
              "$if": {
                "condition": {
                  "$in": [
                    {
                      "$ref": "request.model"
                    },
                    [
                      "dola-sd-2.5",
                      "sd-2.5-j2-V",
                      "sd-2.5-J2"
                    ]
                  ]
                },
                "then": {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    },
                    10
                  ]
                },
                "else": true
              }
            },
            "message": "佳速 dola-sd-2.5、J2 和 J2-V 最多支持 10 段参考音频"
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
                  "$and": [
                    {
                      "$lte": [
                        {
                          "$len": {
                            "$ref": "request.videos"
                          }
                        },
                        3
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$len": {
                            "$ref": "request.audios"
                          }
                        },
                        3
                      ]
                    },
                    {
                      "$lte": [
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
                        },
                        10
                      ]
                    }
                  ]
                },
                "else": true
              }
            },
            "message": "佳速 H3 最多支持 3 视频、3 音频，全部参考素材合计最多 10 个"
          },
          {
            "assert": {
              "$if": {
                "condition": {
                  "$in": [
                    {
                      "$ref": "request.model"
                    },
                    [
                      "sd-2.5-j2-V",
                      "sd-2.5-J2"
                    ]
                  ]
                },
                "then": {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    10
                  ]
                },
                "else": true
              }
            },
            "message": "佳速 J2/J2-V 最多支持 10 段参考视频"
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
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "minimax-h3"
                  ]
                },
                "then": 15,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.duration"
                  }
                }
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
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "minimax-h3"
                  ]
                },
                "then": "2k",
                "else": {
                  "$coalesce": [
                    {
                      "$ref": "request.resolution"
                    },
                    "720p"
                  ]
                }
              }
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
                    },
                    "duration_seconds": {
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
                          "$divide": [
                            {
                              "$ref": "media.metadata.durationMs"
                            },
                            1000
                          ]
                        }
                      }
                    },
                    "mime": {
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
                          "$omitEmpty": {
                            "$ref": "media.mimeType"
                          }
                        }
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
                    },
                    "mime": {
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
                          "$omitEmpty": {
                            "$ref": "media.mimeType"
                          }
                        }
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
