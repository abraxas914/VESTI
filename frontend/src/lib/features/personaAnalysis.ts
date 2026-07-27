import { getConversations, getMessages } from "../services/storageService"

export type PersonaId = "innovator" | "thinker" | "doer"

export interface PersonaBreakdown {
  title: string
  description: string
}

export interface PersonaAnalysis {
  id: PersonaId
  icon: "spark" | "mind" | "tools"
  name: string
  description: string
  sampleSize: number
  breakdown: PersonaBreakdown[]
}

const PERSONAS: Record<PersonaId, Omit<PersonaAnalysis, "sampleSize">> = {
  innovator: {
    id: "innovator",
    icon: "spark",
    name: "创新者",
    description:
      "你习惯用 AI 打开新的可能性，把模糊想法快速变成可以验证的方案。",
    breakdown: [
      {
        title: "思考方式",
        description: "偏爱假设、设计与跨领域联想，愿意先探索再收敛。"
      },
      {
        title: "明显优势",
        description: "能够快速生成选项，并从不同视角重组已有知识。"
      },
      {
        title: "成长提醒",
        description: "为每轮发散补一个明确的验证动作，避免好点子停留在纸面。"
      }
    ]
  },
  thinker: {
    id: "thinker",
    icon: "mind",
    name: "思考者",
    description: "你把 AI 当作推理伙伴，重视原因、机制、证据与概念之间的联系。",
    breakdown: [
      {
        title: "思考方式",
        description: "经常追问为什么，倾向于先建立清晰模型再做判断。"
      },
      {
        title: "明显优势",
        description: "擅长识别隐含假设、比较观点，并保留问题的复杂度。"
      },
      {
        title: "成长提醒",
        description: "给分析设置停止条件，把最可靠的结论及时转化为实验。"
      }
    ]
  },
  doer: {
    id: "doer",
    icon: "tools",
    name: "实干者",
    description: "你更关注下一步怎么做，喜欢把复杂问题拆成步骤、清单和交付物。",
    breakdown: [
      {
        title: "思考方式",
        description: "以目标和约束为中心，优先寻找能立即执行的最小动作。"
      },
      {
        title: "明显优势",
        description: "擅长推进、验证和复盘，能够把对话快速变成实际产出。"
      },
      {
        title: "成长提醒",
        description: "在行动前保留一次反例检查，避免过早锁定单一路线。"
      }
    ]
  }
}

const SIGNALS: Record<PersonaId, string[]> = {
  innovator: ["创新", "设计", "假设", "创意", "可能性", "实验"],
  thinker: ["为什么", "原因", "机制", "分析", "证据", "原理", "比较"],
  doer: ["步骤", "行动", "实施", "执行", "计划", "清单", "交付"]
}

export async function analyzePersona(): Promise<PersonaAnalysis> {
  const conversations = await getConversations()
  const messages = (
    await Promise.all(
      conversations.map((conversation) => getMessages(conversation.id))
    )
  ).flat()
  const corpus = messages.map((message) => message.content_text).join("\n")
  const scores = (Object.keys(SIGNALS) as PersonaId[]).map((id) => ({
    id,
    score: SIGNALS[id].reduce(
      (total, keyword) => total + corpus.split(keyword).length - 1,
      0
    )
  }))
  scores.sort(
    (left, right) =>
      right.score - left.score ||
      (left.id === "thinker" ? -1 : right.id === "thinker" ? 1 : 0)
  )
  return {
    ...PERSONAS[scores[0]?.id ?? "thinker"],
    sampleSize: conversations.length
  }
}
