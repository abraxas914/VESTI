import type { Platform } from "../types"

export const SEED_RANGE_START = "2026-07-18"
export const SEED_RANGE_END = "2026-07-25"

export interface SeedMessage {
  role: "user" | "ai"
  content: string
  createdAt: number
}

export interface SeedConversation {
  id: string
  title: string
  summary: string
  platform: Extract<Platform, "ChatGPT" | "DeepSeek" | "Kimi">
  createdAt: number
  messages: SeedMessage[]
}

function at(date: string, hour: number, minute = 0): number {
  return Date.parse(
    `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0"
    )}:00+08:00`
  )
}

function conversation(
  date: string,
  platform: SeedConversation["platform"],
  slug: string,
  title: string,
  summary: string,
  messages: Array<Pick<SeedMessage, "role" | "content">>
): SeedConversation {
  const createdAt = at(date, 10)
  return {
    id: `vesti-demo-${date}-${platform.toLowerCase()}-${slug}`,
    title,
    summary,
    platform,
    createdAt,
    messages: messages.map((message, index) => ({
      ...message,
      createdAt: createdAt + index * 60_000
    }))
  }
}

export function createSeedConversations(): SeedConversation[] {
  return [
    conversation(
      "2026-07-18",
      "ChatGPT",
      "onboarding",
      "让首次体验在五秒内证明价值",
      "围绕首次启动体验，梳理了无登录、即时反馈和可恢复设置的设计原则。",
      [
        {
          role: "user",
          content: "怎样设计一个无需登录、五秒内能看见价值的首次启动体验？"
        },
        {
          role: "ai",
          content:
            "先提供可直接运行的示例数据，再把设置作为可选路径；每一步都应给出可见结果，并允许用户随时返回。"
        },
        {
          role: "user",
          content: "请把它整理成可以直接实施的检查清单。"
        },
        {
          role: "ai",
          content:
            "检查清单：首屏单一主行动、无注册墙、确定性演示数据、成功反馈、状态持久化、异常可恢复。"
        }
      ]
    ),
    conversation(
      "2026-07-19",
      "DeepSeek",
      "cat-sleep",
      "为什么小猫晚上睡不着",
      "从昼夜节律、环境刺激和行为强化三个角度解释幼猫夜间活跃。",
      [
        {
          role: "user",
          content: "从生物作息的角度，让我简单明白为什么小猫晚上睡不着。"
        },
        {
          role: "ai",
          content:
            "猫偏晨昏活动，幼猫精力恢复快；白天睡得多、夜间光线和声音刺激、睡前互动都会让它在晚上更活跃。"
        },
        {
          role: "user",
          content: "有哪些温和且可执行的调整方法？"
        },
        {
          role: "ai",
          content:
            "固定白天互动和晚间喂食时间，睡前安排短时高质量玩耍，逐步降低夜间回应强度，并排除身体不适。"
        }
      ]
    ),
    conversation(
      "2026-07-20",
      "Kimi",
      "knowledge-search",
      "个人知识库如何做到可检索",
      "比较关键词检索、语义检索与来源引用，形成本地优先的知识库方案。",
      [
        {
          role: "user",
          content: "我想让历史 AI 对话变成一个可以追溯来源的个人知识库。"
        },
        {
          role: "ai",
          content:
            "可以先用全文索引保证确定性命中，再叠加语义召回；回答时保留会话标题、平台和原文片段作为来源。"
        },
        {
          role: "user",
          content: "为什么不能只依赖向量检索？"
        },
        {
          role: "ai",
          content:
            "专有名词、代码和精确短语更适合全文检索；混合检索能兼顾准确匹配与语义相关性。"
        }
      ]
    ),
    conversation(
      "2026-07-21",
      "ChatGPT",
      "weekly-review",
      "把一周思考整理成行动线索",
      "将分散对话聚合为主题、结论、未决问题和下一步行动。",
      [
        {
          role: "user",
          content: "一周聊了很多内容，怎样避免回顾变成流水账？"
        },
        {
          role: "ai",
          content:
            "不要按日期复述，而要按主题聚合：每个主题只保留关键转折、已确认结论、仍未解决的问题和下一步。"
        },
        {
          role: "user",
          content: "给我一个适合长期坚持的结构。"
        },
        {
          role: "ai",
          content:
            "每周保留四栏：本周关注、认知变化、可复用方法、下周最小行动。"
        }
      ]
    ),
    conversation(
      "2026-07-23",
      "DeepSeek",
      "extension-security",
      "浏览器扩展如何保护模型密钥",
      "明确 Content Script、Background 与本地存储之间的安全边界。",
      [
        {
          role: "user",
          content: "浏览器扩展里的模型 API Key 应该放在哪里？"
        },
        {
          role: "ai",
          content:
            "密钥只应由扩展后台读取和使用；Content Script 通过受控消息协议请求能力，不直接接触密钥或拼装认证头。"
        },
        {
          role: "user",
          content: "还需要防范哪些边界问题？"
        },
        {
          role: "ai",
          content:
            "校验消息类型和参数，限制可调用能力，避免把密钥写入日志，并为网络失败提供不泄露内部信息的错误反馈。"
        }
      ]
    ),
    conversation(
      "2026-07-24",
      "Kimi",
      "experiment",
      "用最小实验验证知识工作流",
      "设计一个一天内可完成的实验，验证收藏、检索和延续对话是否形成闭环。",
      [
        {
          role: "user",
          content: "我想快速验证收藏、检索、继续提问这条链路有没有真实价值。"
        },
        {
          role: "ai",
          content:
            "选三个真实问题，各保存一段对话；隔几个小时只凭关键词找回，然后从合并摘要继续提出一个新问题。"
        },
        {
          role: "user",
          content: "怎样判断实验成功？"
        },
        {
          role: "ai",
          content:
            "记录找回耗时、命中片段是否正确、继续提问是否减少重复说明，以及最终是否产生了可执行的新结论。"
        }
      ]
    ),
    conversation(
      "2026-07-25",
      "ChatGPT",
      "execution",
      "把宏大计划拆成今天能完成的动作",
      "通过优先级、验收标准和风险前置，把复杂项目转化为可执行计划。",
      [
        {
          role: "user",
          content: "面对一个宏大项目，我怎样避免一直规划却没有交付？"
        },
        {
          role: "ai",
          content:
            "先定义最小可验收结果，再列出阻塞它的关键风险；每个阶段都必须产生可运行产物和可复现的验证记录。"
        },
        {
          role: "user",
          content: "请给出今天的三个动作。"
        },
        {
          role: "ai",
          content:
            "第一，完成确定性演示数据；第二，打通侧栏四个核心入口；第三，跑完类型、单测和生产构建并记录缺口。"
        }
      ]
    )
  ]
}
