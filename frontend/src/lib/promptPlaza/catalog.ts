// AUTO-GENERATED curated catalog for the 提示词超市 (Prompt Supermarket).
// Regenerated from the r5-catalog-gen workflow; prefer regenerating over hand-edits.
import type { CuratedPrompt } from "./commonPrompts";

export const GENERATED_CATALOG: CuratedPrompt[] = [
  {
    "id": "writing-polish-rewrite",
    "category": {
      "en": "Writing",
      "zh": "写作"
    },
    "title": {
      "en": "Polish & rewrite text",
      "zh": "润色改写文本"
    },
    "body": {
      "en": "You are an expert editor. Rewrite the text below to improve clarity, flow, and impact while preserving the original meaning and the author's intent.\n\nConstraints:\n- Keep the same language as the source unless I specify otherwise.\n- Target tone: {{tone (e.g. professional / friendly / persuasive)}}\n- Target length: {{about the same / shorter / a specific word count}}\n- Fix grammar, awkward phrasing, redundancy, and weak word choices.\n- Do not add facts that aren't in the original.\n\nOutput:\n1. The polished version.\n2. A short bullet list of the key changes you made and why.\n\nText to improve:\n{{paste your text here}}",
      "zh": "你是一位资深文字编辑。请改写下面这段文字，在保留原意和作者意图的前提下，提升其清晰度、流畅度和表现力。\n\n要求：\n- 除非另有说明，保持与原文相同的语言。\n- 目标语气：{{语气（如：专业／亲切／有说服力）}}\n- 目标篇幅：{{与原文相当／更精简／指定字数}}\n- 修正语法、生硬表达、冗余和用词不当之处。\n- 不要添加原文中没有的事实信息。\n\n输出：\n1. 润色后的版本。\n2. 用简短的要点列出你做的主要修改及原因。\n\n待改写文字：\n{{在此粘贴你的文字}}"
    },
    "source": "Anthropic Prompt Library",
    "sourceUrl": "https://docs.anthropic.com/en/prompt-library/library"
  },
  {
    "id": "writing-grammar-proofread",
    "category": {
      "en": "Writing",
      "zh": "写作"
    },
    "title": {
      "en": "Proofread & fix grammar",
      "zh": "校对纠正语法"
    },
    "body": {
      "en": "Act as a meticulous proofreader. Correct all spelling, grammar, punctuation, and capitalization errors in the text below. Do NOT rewrite the style, change the meaning, or rephrase sentences beyond what is needed to make them correct.\n\nOutput as a table with three columns: Original | Corrected | Reason.\nIf the text is already correct, say so.\n\nLanguage of the text: {{language, e.g. English}}\n\nText:\n{{paste your text here}}",
      "zh": "请扮演一名严谨的校对员。修正下面这段文字中所有的拼写、语法、标点和大小写错误。不要改变文风、含义，也不要在纠错必要之外重写句子。\n\n以表格形式输出，包含三列：原文 | 修正后 | 原因。\n如果文字本身已无误，请直接说明。\n\n文字语言：{{语言，如：中文}}\n\n文字：\n{{在此粘贴你的文字}}"
    },
    "source": "Vesti curated"
  },
  {
    "id": "writing-blog-outline",
    "category": {
      "en": "Writing",
      "zh": "写作"
    },
    "title": {
      "en": "Blog post outline",
      "zh": "博客文章大纲"
    },
    "body": {
      "en": "You are a content strategist. Create a detailed outline for a blog post.\n\nTopic: {{topic}}\nTarget audience: {{who will read this}}\nGoal of the post: {{inform / persuade / drive signups / etc.}}\nDesired length: {{e.g. 1200 words}}\n\nDeliver:\n1. Three working title options (SEO-aware).\n2. A one-sentence hook for the introduction.\n3. A hierarchical outline (H2/H3) with a one-line note on what each section covers.\n4. A suggested call-to-action for the ending.\n5. 5-8 relevant keywords to weave in.",
      "zh": "你是一名内容策略师。请为一篇博客文章创建详细大纲。\n\n主题：{{主题}}\n目标读者：{{谁会阅读这篇文章}}\n文章目的：{{告知／说服／引导注册 等}}\n期望篇幅：{{如：1200 字}}\n\n请输出：\n1. 三个备选标题（兼顾 SEO）。\n2. 一句话的开篇钩子。\n3. 分层级的大纲（H2／H3），每节附一句话说明该部分内容。\n4. 结尾处建议的行动号召（CTA）。\n5. 5-8 个可自然融入的相关关键词。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "writing-email-compose",
    "category": {
      "en": "Writing",
      "zh": "写作"
    },
    "title": {
      "en": "Draft professional email",
      "zh": "撰写专业邮件"
    },
    "body": {
      "en": "Write a professional email based on the details below.\n\nFrom: {{your name / role}}\nTo: {{recipient and relationship}}\nPurpose: {{what you want to achieve}}\nKey points to include: {{bullet the facts/requests}}\nTone: {{formal / warm / firm but polite}}\nDesired action from recipient: {{what they should do next}}\n\nRequirements:\n- Clear, specific subject line.\n- Concise body (no filler), well-structured paragraphs.\n- Polite, unambiguous closing with the requested next step.\n\nReturn the subject line and the email body, ready to send.",
      "zh": "请根据以下信息撰写一封专业邮件。\n\n发件人：{{你的姓名／职位}}\n收件人：{{对方及与你的关系}}\n目的：{{你想达成什么}}\n须包含的要点：{{列出事实／诉求}}\n语气：{{正式／温和／坚定而礼貌}}\n希望对方采取的行动：{{对方下一步该做什么}}\n\n要求：\n- 标题清晰、具体。\n- 正文简洁（不啰嗦），段落结构清晰。\n- 结尾礼貌、明确，点明所请求的下一步。\n\n请输出邮件标题和正文，可直接发送。"
    },
    "source": "Awesome ChatGPT Prompts",
    "sourceUrl": "https://github.com/f/awesome-chatgpt-prompts"
  },
  {
    "id": "writing-summarize-text",
    "category": {
      "en": "Writing",
      "zh": "写作"
    },
    "title": {
      "en": "Summarize long text",
      "zh": "长文摘要总结"
    },
    "body": {
      "en": "Summarize the text below for a reader who has not seen it.\n\nFormat:\n- TL;DR: one to two sentences capturing the core message.\n- Key points: 3-6 bullet points of the most important ideas.\n- Notable details / numbers: anything quantitative or surprising worth keeping.\n- Action items (if any): concrete things the reader should do.\n\nConstraints:\n- Be faithful to the source; do not invent or infer beyond it.\n- Output language: {{language}}\n- Keep it concise and skimmable.\n\nText to summarize:\n{{paste your text here}}",
      "zh": "请为没读过原文的读者总结下面这段文字。\n\n格式：\n- 一句话总结：用一到两句话概括核心信息。\n- 关键要点：3-6 条最重要的观点。\n- 重要细节／数据：值得保留的量化或出人意料的信息。\n- 行动项（若有）：读者应采取的具体行动。\n\n要求：\n- 忠于原文，不臆测、不添加原文之外的内容。\n- 输出语言：{{语言}}\n- 简洁、便于快速浏览。\n\n待总结文字：\n{{在此粘贴你的文字}}"
    },
    "source": "OpenAI Cookbook",
    "sourceUrl": "https://cookbook.openai.com/"
  },
  {
    "id": "writing-adjust-tone",
    "category": {
      "en": "Writing",
      "zh": "写作"
    },
    "title": {
      "en": "Change tone & style",
      "zh": "调整语气风格"
    },
    "body": {
      "en": "Rewrite the text below in a different tone and style without changing its meaning or removing any key information.\n\nNew tone/style: {{e.g. more casual / more formal / confident / empathetic / playful}}\nAudience: {{who it's for}}\nFormat to keep: {{plain text / email / social post / message}}\n\nRules:\n- Preserve all facts and the core intent.\n- Match natural phrasing for the chosen tone.\n- Keep roughly the same length unless I say otherwise.\n\nOriginal text:\n{{paste your text here}}",
      "zh": "请用不同的语气和风格改写下面这段文字，但不改变其含义，也不删除任何关键信息。\n\n新语气／风格：{{如：更随意／更正式／自信／有同理心／俏皮}}\n受众：{{写给谁}}\n保持的格式：{{纯文本／邮件／社交帖子／消息}}\n\n规则：\n- 保留所有事实和核心意图。\n- 使用契合所选语气的自然表达。\n- 除非另有说明，篇幅大致保持不变。\n\n原文：\n{{在此粘贴你的文字}}"
    },
    "source": "Learn Prompting",
    "sourceUrl": "https://learnprompting.org/"
  },
  {
    "id": "writing-social-variations",
    "category": {
      "en": "Writing",
      "zh": "写作"
    },
    "title": {
      "en": "Social post variations",
      "zh": "社媒文案变体"
    },
    "body": {
      "en": "You are a social media copywriter. Turn the idea below into ready-to-post content for {{platform, e.g. X / LinkedIn / Instagram}}.\n\nIdea / message: {{what you want to say}}\nGoal: {{engagement / clicks / awareness}}\nVoice: {{brand or personal voice}}\n\nDeliver 3 distinct variations, each with:\n- A scroll-stopping hook (first line).\n- The body, sized for the platform's norms.\n- A clear call-to-action.\n- 3-5 relevant hashtags (if appropriate for the platform).\n\nLabel each variation by its angle (e.g. story-driven, data-driven, contrarian).",
      "zh": "你是一名社交媒体文案撰稿人。请把下面的想法转化为可直接发布的 {{平台，如：微博／小红书／领英}} 内容。\n\n想法／信息：{{你想表达什么}}\n目标：{{互动／点击／曝光}}\n语气：{{品牌或个人调性}}\n\n请提供 3 个截然不同的版本，每个包含：\n- 一句抓人眼球的开头钩子（首行）。\n- 符合该平台习惯篇幅的正文。\n- 明确的行动号召。\n- 3-5 个相关话题标签（若适用于该平台）。\n\n请为每个版本标注其切入角度（如：故事型、数据型、反常识型）。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "coding-code-review",
    "category": {
      "en": "Coding",
      "zh": "编程"
    },
    "title": {
      "en": "Code review",
      "zh": "代码审查"
    },
    "body": {
      "en": "You are a senior {{language}} engineer doing a thorough code review. Review the code below and report findings grouped by severity (Critical / Major / Minor / Nitpick). For each finding, give: the location, what's wrong, why it matters, and a concrete fix (with a code snippet). Focus on correctness, edge cases, security, performance, readability, and naming. Do not rewrite the whole file; be specific and actionable. End with a short overall assessment.\n\n```{{language}}\n{{code}}\n```",
      "zh": "你是一位资深 {{语言}} 工程师，请对下面的代码做一次细致的代码审查。按严重程度分组列出问题（严重 / 重要 / 次要 / 吹毛求疵）。每条问题请给出：位置、问题所在、为什么重要、以及具体的修复方案（附代码片段）。重点关注正确性、边界情况、安全性、性能、可读性和命名。不要重写整个文件，要具体、可落地。最后给出一句总体评价。\n\n```{{语言}}\n{{代码}}\n```"
    },
    "source": "Anthropic Prompt Library",
    "sourceUrl": "https://docs.anthropic.com/en/prompt-library/library"
  },
  {
    "id": "coding-debug-error",
    "category": {
      "en": "Coding",
      "zh": "编程"
    },
    "title": {
      "en": "Debug an error",
      "zh": "调试报错"
    },
    "body": {
      "en": "Act as a debugging partner. I'm hitting an error in {{language}}. Here is what I expected to happen, what actually happened, the relevant code, and the full error/stack trace.\n\nExpected: {{expected_behavior}}\nActual: {{actual_behavior}}\n\nCode:\n```{{language}}\n{{code}}\n```\n\nError / stack trace:\n```\n{{error_message}}\n```\n\nWalk through the most likely root cause first, explain the reasoning step by step, then give the minimal fix as a diff or corrected snippet. If you need more info to be sure, list the exact questions or commands that would confirm the cause.",
      "zh": "请作为我的调试搭档。我在 {{语言}} 中遇到了一个报错。下面是我期望的行为、实际发生的情况、相关代码，以及完整的错误信息/堆栈。\n\n期望：{{期望行为}}\n实际：{{实际行为}}\n\n代码：\n```{{语言}}\n{{代码}}\n```\n\n报错 / 堆栈：\n```\n{{错误信息}}\n```\n\n请先给出最可能的根因，逐步解释推理过程，再给出最小化的修复（diff 或修正后的片段）。如果还需要更多信息才能确定，请列出能确认根因的具体问题或命令。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "coding-refactor-clean",
    "category": {
      "en": "Coding",
      "zh": "编程"
    },
    "title": {
      "en": "Refactor code",
      "zh": "重构代码"
    },
    "body": {
      "en": "Refactor the following {{language}} code to be cleaner and more maintainable WITHOUT changing its external behavior. Improve naming, reduce duplication, simplify control flow, and apply idiomatic {{language}} patterns. Keep the public interface stable. Return: (1) the refactored code, (2) a bullet list of the changes you made and why, (3) any behavior you deliberately preserved that looked suspicious. Do not add new dependencies unless you justify them.\n\n```{{language}}\n{{code}}\n```",
      "zh": "请在不改变外部行为的前提下，重构下面的 {{语言}} 代码，使其更清晰、更易维护。改进命名、消除重复、简化控制流，并使用符合 {{语言}} 习惯的写法。保持对外接口不变。请返回：(1) 重构后的代码；(2) 列出你所做的改动及原因；(3) 任何你刻意保留、但看起来可疑的行为。除非有充分理由，否则不要引入新依赖。\n\n```{{语言}}\n{{代码}}\n```"
    },
    "source": "Vesti curated"
  },
  {
    "id": "coding-write-tests",
    "category": {
      "en": "Coding",
      "zh": "编程"
    },
    "title": {
      "en": "Write unit tests",
      "zh": "编写单元测试"
    },
    "body": {
      "en": "Write thorough unit tests for the following {{language}} code using {{test_framework}}. Cover the happy path, edge cases, boundary values, invalid inputs, and error handling. Use clear, descriptive test names and the Arrange-Act-Assert structure. Mock external dependencies where needed. After the tests, list any cases you could not cover and explain why. Output only runnable test code plus that short note.\n\n```{{language}}\n{{code}}\n```",
      "zh": "请用 {{测试框架}} 为下面的 {{语言}} 代码编写完整的单元测试。覆盖正常路径、边界情况、临界值、非法输入和错误处理。使用清晰、描述性的测试名称，并采用「准备-执行-断言」的结构。需要时对外部依赖进行 mock。测试之后，列出你无法覆盖的场景并说明原因。只输出可直接运行的测试代码和那段简短说明。\n\n```{{语言}}\n{{代码}}\n```"
    },
    "source": "Anthropic Prompt Library",
    "sourceUrl": "https://docs.anthropic.com/en/prompt-library/library"
  },
  {
    "id": "coding-explain-code",
    "category": {
      "en": "Coding",
      "zh": "编程"
    },
    "title": {
      "en": "Explain this code",
      "zh": "解释代码"
    },
    "body": {
      "en": "Explain the following {{language}} code to a developer who is new to this codebase. Start with a one-sentence summary of what it does. Then give a step-by-step walkthrough of the logic, call out any non-obvious tricks, side effects, or assumptions, and note the time/space complexity if relevant. Finish with potential pitfalls or things to watch out for when modifying it. Keep it concise and avoid restating the obvious.\n\n```{{language}}\n{{code}}\n```",
      "zh": "请把下面的 {{语言}} 代码解释给一位刚接触这个代码库的开发者。先用一句话概括它的作用，然后逐步讲解其逻辑，指出任何不显而易见的技巧、副作用或前提假设，并在相关时说明时间/空间复杂度。最后提示修改它时可能踩的坑或需要注意的地方。保持简洁，不要重复显而易见的内容。\n\n```{{语言}}\n{{代码}}\n```"
    },
    "source": "Anthropic Prompt Library",
    "sourceUrl": "https://docs.anthropic.com/en/prompt-library/library"
  },
  {
    "id": "coding-sql-from-spec",
    "category": {
      "en": "Coding",
      "zh": "编程"
    },
    "title": {
      "en": "Generate SQL query",
      "zh": "生成 SQL 查询"
    },
    "body": {
      "en": "You are a SQL expert writing for {{database}}. Given the schema and the question below, write a correct, efficient query. Use clear aliases and join only what you need. After the query, explain in plain language what it returns, list any assumptions you made about the schema, and suggest an index if it would meaningfully help. If the question is ambiguous, state the interpretation you chose.\n\nSchema:\n{{schema}}\n\nQuestion:\n{{question}}",
      "zh": "你是一位针对 {{数据库}} 的 SQL 专家。根据下面的表结构和问题，写出一条正确、高效的查询。使用清晰的别名，只做必要的连接。查询之后，用通俗的语言说明它返回什么，列出你对表结构所做的假设，并在确实有帮助时建议添加索引。如果问题有歧义，请说明你采用的理解方式。\n\n表结构：\n{{表结构}}\n\n问题：\n{{问题}}"
    },
    "source": "Vesti curated"
  },
  {
    "id": "coding-commit-message",
    "category": {
      "en": "Coding",
      "zh": "编程"
    },
    "title": {
      "en": "Write commit message",
      "zh": "写提交信息"
    },
    "body": {
      "en": "Write a clear Git commit message for the following diff, using the Conventional Commits format (type(scope): subject). Keep the subject under 72 characters and in the imperative mood. Add a body that explains WHAT changed and WHY (not how), wrapped at ~72 chars, only if the change needs context. Note any breaking changes with a BREAKING CHANGE: footer. Output only the commit message.\n\n```diff\n{{diff}}\n```",
      "zh": "请为下面的 diff 写一条清晰的 Git 提交信息，采用 Conventional Commits 格式（type(scope): subject）。标题使用祈使语气，控制在 72 个字符以内。仅在改动需要背景说明时，添加正文解释「改了什么」和「为什么」（而不是怎么改的），每行约 72 字符换行。若有破坏性变更，用 BREAKING CHANGE: 脚注注明。只输出提交信息本身。\n\n```diff\n{{diff}}\n```"
    },
    "source": "Vesti curated"
  },
  {
    "id": "data-eda-explorer",
    "category": {
      "en": "Data & Analysis",
      "zh": "数据分析"
    },
    "title": {
      "en": "Exploratory Data Analysis",
      "zh": "探索性数据分析"
    },
    "body": {
      "en": "You are a senior data analyst. I will give you a dataset description and a sample. Run a structured exploratory data analysis.\n\nDataset description: {{dataset_description}}\nColumns (name: type): {{columns}}\nSample rows (CSV or table): {{sample_rows}}\nAnalysis goal: {{goal}}\n\nDeliver:\n1. Data overview: row/column counts, likely grain, primary keys.\n2. Per-column profile: type, range/distribution, missing %, outliers, suspicious values.\n3. Relationships: notable correlations or dependencies between columns (state direction and strength qualitatively).\n4. Data quality risks that could distort the analysis.\n5. Three to five concrete hypotheses worth testing for the goal, each with the columns and method you'd use.\n6. Recommended next steps.\n\nState every assumption explicitly. Do not invent values not present in the sample.",
      "zh": "你是一位资深数据分析师。我会提供数据集说明和样本，请进行一次结构化的探索性数据分析。\n\n数据集说明：{{数据集说明}}\n字段（名称：类型）：{{字段列表}}\n样本数据（CSV 或表格）：{{样本数据}}\n分析目标：{{分析目标}}\n\n请输出：\n1. 数据概览：行列数量、数据粒度、可能的主键。\n2. 逐列画像：类型、取值范围/分布、缺失率、异常值、可疑取值。\n3. 字段间关系：值得关注的相关性或依赖关系（定性说明方向与强弱）。\n4. 可能干扰分析结论的数据质量风险。\n5. 围绕目标提出 3-5 个值得验证的假设，每个标明所用字段与方法。\n6. 建议的下一步动作。\n\n请明确列出所有假设，不要编造样本中不存在的数据。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "data-nl-to-sql",
    "category": {
      "en": "Data & Analysis",
      "zh": "数据分析"
    },
    "title": {
      "en": "Natural Language to SQL",
      "zh": "自然语言转 SQL"
    },
    "body": {
      "en": "You are an expert SQL engineer for {{sql_dialect}}. Translate my request into a correct, efficient query.\n\nSchema (tables, columns, types, keys):\n{{schema}}\n\nRequest: {{question}}\n\nRules:\n- Use only tables and columns that exist in the schema.\n- Prefer explicit JOINs and qualify columns with table aliases.\n- Handle NULLs and avoid duplicate rows where it matters.\n- Add a short comment above each non-obvious clause.\n\nReturn:\n1. The SQL query in a code block.\n2. A one-line explanation of what it returns.\n3. Any assumptions you made about the schema or intent.\n4. If the request is ambiguous, ask before guessing.",
      "zh": "你是精通 {{SQL方言}} 的 SQL 工程师，请将我的需求转换为正确且高效的查询语句。\n\n表结构（表、字段、类型、键）：\n{{表结构}}\n\n需求：{{需求描述}}\n\n规则：\n- 只能使用表结构中真实存在的表和字段。\n- 优先使用显式 JOIN，并用表别名限定字段。\n- 妥善处理 NULL，必要时避免重复行。\n- 在不直观的子句上方加一行简短注释。\n\n请返回：\n1. 代码块形式的 SQL 查询。\n2. 一句话说明查询结果含义。\n3. 你对表结构或意图所做的假设。\n4. 若需求有歧义，先提问再动手，不要臆测。"
    },
    "source": "Awesome ChatGPT Prompts",
    "sourceUrl": "https://github.com/f/awesome-chatgpt-prompts"
  },
  {
    "id": "data-stat-test-chooser",
    "category": {
      "en": "Data & Analysis",
      "zh": "数据分析"
    },
    "title": {
      "en": "Choose a Statistical Test",
      "zh": "选择统计检验方法"
    },
    "body": {
      "en": "Act as a statistician. Help me pick and apply the right statistical test, and avoid common pitfalls.\n\nResearch question: {{question}}\nWhat I'm comparing / the variables: {{variables}}\nData type of each variable (categorical/ordinal/continuous): {{variable_types}}\nSample size and group structure (paired? independent? how many groups?): {{design}}\nKnown about distribution/assumptions: {{assumptions}}\n\nProvide:\n1. The recommended test (and a non-parametric fallback if assumptions fail).\n2. Why this test fits, and the assumptions to check first.\n3. How to interpret the result, including effect size and what a p-value does and does not tell us.\n4. Common mistakes for this scenario (e.g., multiple comparisons, peeking).\n5. The exact steps or formula/function to run it in {{tool}}.\n\nDo not overstate certainty; flag where more information is needed.",
      "zh": "请扮演统计学家，帮我选择并正确应用统计检验方法，规避常见陷阱。\n\n研究问题：{{研究问题}}\n要比较的对象/变量：{{变量}}\n各变量的数据类型（分类/有序/连续）：{{变量类型}}\n样本量与分组结构（配对？独立？几组？）：{{实验设计}}\n关于分布/假设的已知信息：{{分布假设}}\n\n请给出：\n1. 推荐的检验方法（若假设不满足，给出非参数替代方案）。\n2. 选择该方法的理由，以及需要先检查的前提假设。\n3. 如何解读结果，包括效应量，以及 p 值能说明和不能说明什么。\n4. 该场景下的常见错误（如多重比较、提前窥探数据）。\n5. 在 {{工具}} 中执行该检验的具体步骤或公式/函数。\n\n不要夸大确定性，需要补充信息时请明确指出。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "data-spreadsheet-formula",
    "category": {
      "en": "Data & Analysis",
      "zh": "数据分析"
    },
    "title": {
      "en": "Spreadsheet Formula Helper",
      "zh": "表格公式助手"
    },
    "body": {
      "en": "You are a spreadsheet expert for {{tool}} (Excel or Google Sheets). Write a formula that does exactly what I describe.\n\nWhat I want to compute: {{goal}}\nData layout (which columns/ranges hold what, with example cells): {{layout}}\nEdge cases to handle (blanks, errors, text vs number, duplicates): {{edge_cases}}\n\nReturn:\n1. The formula in a code block, ready to paste, using the cell references above.\n2. A plain-language explanation of each part.\n3. How to drag/fill it down or across correctly (absolute vs relative refs).\n4. One alternative approach (e.g., pivot table, helper column) if it's simpler or more robust.\n\nIf my layout is unclear, ask one clarifying question before writing the formula.",
      "zh": "你是 {{工具}}（Excel 或 Google Sheets）公式专家，请写出完全符合我描述的公式。\n\n我要计算的内容：{{计算目标}}\n数据布局（各列/区域存放什么，并给出示例单元格）：{{数据布局}}\n需处理的边界情况（空值、错误、文本与数字、重复项）：{{边界情况}}\n\n请返回：\n1. 代码块形式、可直接粘贴的公式，使用上述单元格引用。\n2. 用通俗语言逐段解释公式。\n3. 如何正确向下/向右填充（绝对引用与相对引用的区别）。\n4. 若有更简单或更稳健的方案（如数据透视表、辅助列），给出一种替代做法。\n\n若数据布局不清楚，请先提出一个澄清问题再写公式。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "data-cleaning-audit",
    "category": {
      "en": "Data & Analysis",
      "zh": "数据分析"
    },
    "title": {
      "en": "Data Cleaning Plan",
      "zh": "数据清洗方案"
    },
    "body": {
      "en": "You are a data quality engineer. Audit my dataset and produce a concrete cleaning plan.\n\nColumns (name: type): {{columns}}\nSample rows: {{sample_rows}}\nIntended use of the data: {{intended_use}}\nTarget tool/language for cleaning (e.g., Python pandas, SQL, R): {{tool}}\n\nProduce:\n1. A quality checklist scored per column: missing values, type mismatches, inconsistent formats (dates, units, casing), duplicates, outliers, invalid categories.\n2. For each issue: severity, likely cause, and the recommended fix (impute / drop / standardize / flag), with the tradeoff.\n3. A step-by-step cleaning pipeline in the right order, with {{tool}} code snippets for the key steps.\n4. Validation checks to confirm the data is clean afterward.\n5. Issues to escalate to a human rather than auto-fix.\n\nNever silently drop data without saying so and why.",
      "zh": "你是数据质量工程师，请审计我的数据集并给出可执行的清洗方案。\n\n字段（名称：类型）：{{字段列表}}\n样本数据：{{样本数据}}\n数据用途：{{数据用途}}\n清洗所用工具/语言（如 Python pandas、SQL、R）：{{工具}}\n\n请输出：\n1. 逐列质量清单评估：缺失值、类型不符、格式不一致（日期、单位、大小写）、重复、异常值、非法分类。\n2. 针对每个问题：严重程度、可能成因、推荐处理方式（填补/删除/标准化/标记）及其取舍。\n3. 按正确顺序排列的分步清洗流程，关键步骤附 {{工具}} 代码片段。\n4. 清洗后用于确认数据干净的校验步骤。\n5. 应交由人工判断、不宜自动修复的问题。\n\n绝不在未说明原因的情况下悄悄删除数据。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "data-chart-recommender",
    "category": {
      "en": "Data & Analysis",
      "zh": "数据分析"
    },
    "title": {
      "en": "Recommend the Right Chart",
      "zh": "推荐合适的图表"
    },
    "body": {
      "en": "You are a data visualization expert. Recommend how to visualize my data for a specific message and audience.\n\nWhat I want the viewer to understand: {{key_message}}\nData I have (variables and their types): {{data}}\nAudience and medium (e.g., execs in a slide, analysts in a dashboard): {{audience}}\nNumber of categories / data points: {{cardinality}}\n\nProvide:\n1. The single best chart type and why it fits the message and data types.\n2. One or two alternatives, with when to prefer each.\n3. Encoding choices: what goes on x/y, color, size; sorting and aggregation.\n4. Design tips for clarity (labels, scale, color use, what to remove) and accessibility.\n5. Chart types to avoid here and why (e.g., pie with many slices, dual axes).\n\nKeep it practical and tied to my actual data, not generic advice.",
      "zh": "你是数据可视化专家，请根据我要传达的信息和受众，推荐合适的可视化方式。\n\n我希望观众理解的核心信息：{{核心信息}}\n现有数据（变量及其类型）：{{数据}}\n受众与呈现媒介（如：给高管看的幻灯片、给分析师用的看板）：{{受众与媒介}}\n类别数量/数据点数量：{{数据规模}}\n\n请给出：\n1. 最合适的单一图表类型，并说明为何契合该信息与数据类型。\n2. 一到两个备选方案，及各自的适用场景。\n3. 编码方案：x/y 轴、颜色、大小分别表示什么；排序与聚合方式。\n4. 提升清晰度的设计建议（标签、坐标轴、配色、应删减的元素）及无障碍考量。\n5. 此场景应避免的图表类型及原因（如多扇区饼图、双坐标轴）。\n\n请紧扣我的实际数据给出实用建议，不要泛泛而谈。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "data-kpi-insight-narrative",
    "category": {
      "en": "Data & Analysis",
      "zh": "数据分析"
    },
    "title": {
      "en": "Turn Metrics Into Insights",
      "zh": "从指标提炼洞察"
    },
    "body": {
      "en": "You are an analytics lead writing an insight summary for {{audience}}. Turn these numbers into a clear, decision-ready narrative.\n\nMetrics and values (with current vs prior period if available): {{metrics}}\nContext / what happened this period: {{context}}\nThe decision or question this should inform: {{decision}}\n\nDeliver:\n1. Headline: the single most important takeaway in one sentence.\n2. What changed: 3-5 bullet insights, each stating the metric, the magnitude and direction, and likely driver. Separate correlation from confirmed cause.\n3. So what: the business implication for the decision above.\n4. Watch-outs: anything in the data that is uncertain, noisy, or needs a deeper look.\n5. Recommended next actions, prioritized.\n\nBe precise with numbers, avoid jargon, and clearly mark anything that is a hypothesis rather than a fact.",
      "zh": "你是数据分析负责人，正在为 {{受众}} 撰写洞察总结。请把这些数字转化为清晰、可直接支撑决策的叙述。\n\n指标及数值（如有，请附本期与上期对比）：{{指标数据}}\n背景/本期发生了什么：{{背景}}\n这份总结要支撑的决策或问题：{{决策问题}}\n\n请输出：\n1. 标题：用一句话点出最重要的结论。\n2. 发生了什么变化：3-5 条要点洞察，每条说明指标、变化幅度与方向及可能的驱动因素，并区分相关性与已证实的因果。\n3. 意味着什么：对上述决策的业务影响。\n4. 注意事项：数据中存在的不确定、噪声或需进一步深挖之处。\n5. 按优先级排列的下一步行动建议。\n\n数字要精确，避免行话，并明确标注哪些只是假设而非事实。"
    },
    "source": "Anthropic Prompt Library",
    "sourceUrl": "https://docs.anthropic.com/en/prompt-library/library"
  },
  {
    "id": "learning-explain-like-levels",
    "category": {
      "en": "Learning",
      "zh": "学习"
    },
    "title": {
      "en": "Explain at 3 Levels",
      "zh": "三档难度讲解"
    },
    "body": {
      "en": "Explain the concept of {{topic}} to me at three escalating levels of depth:\n\n1. **Like I'm a beginner** — plain language, one everyday analogy, no jargon.\n2. **Like I'm an undergraduate** — introduce the key terms, mechanisms, and why it matters.\n3. **Like I'm an expert** — precise definitions, edge cases, common misconceptions, and how it connects to {{related_field}}.\n\nAfter the three levels, give me one concrete example and one question I should be able to answer if I truly understood it.",
      "zh": "请用三个由浅入深的层次为我讲解「{{主题}}」这个概念：\n\n1. **当我是初学者**——用大白话，配一个日常生活中的类比，不要术语。\n2. **当我是本科生**——引入关键术语、运作机制，以及它为什么重要。\n3. **当我是专家**——给出精确定义、边界情况、常见误区，以及它与「{{相关领域}}」的联系。\n\n三个层次之后，请给我一个具体例子，再提一个「如果我真正理解了就应该能回答」的问题。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "learning-feynman-tutor",
    "category": {
      "en": "Learning",
      "zh": "学习"
    },
    "title": {
      "en": "Feynman Check My Understanding",
      "zh": "费曼检验理解"
    },
    "body": {
      "en": "I'm going to explain {{topic}} in my own words, and I want you to act as a strict Feynman-technique tutor.\n\nMy explanation:\n\"\"\"\n{{my_explanation}}\n\"\"\"\n\nDo the following:\n1. Point out exactly where my explanation is vague, wrong, or hand-wavy — quote the part.\n2. Identify any gap that shows I don't actually understand the underlying mechanism.\n3. Fix each issue with a clear, correct rephrasing.\n4. Give me a 2-sentence \"gold standard\" explanation I can compare against.\n\nBe direct. Don't flatter me — the goal is to find what I'm missing.",
      "zh": "我要用自己的话来解释「{{主题}}」，请你扮演一位严格的费曼学习法导师。\n\n我的解释：\n\"\"\"\n{{我的解释}}\n\"\"\"\n\n请完成以下事项：\n1. 准确指出我的解释中模糊、错误或含糊带过的地方——把原话引出来。\n2. 找出任何暴露我并未真正理解底层机制的漏洞。\n3. 对每个问题给出清晰、正确的改写。\n4. 给我一段两句话的「标准答案」解释，供我对照。\n\n请直截了当，不要恭维我——目标是找出我漏掉了什么。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "learning-study-plan-builder",
    "category": {
      "en": "Learning",
      "zh": "学习"
    },
    "title": {
      "en": "Build a Study Plan",
      "zh": "制定学习计划"
    },
    "body": {
      "en": "Act as a learning coach and design a realistic study plan for me.\n\n- Goal: {{what_i_want_to_learn_or_achieve}}\n- Current level: {{current_level}}\n- Time available: {{hours_per_week}} hours/week for {{number_of_weeks}} weeks\n- Preferred way to learn: {{reading_videos_projects_etc}}\n\nProduce:\n1. A week-by-week roadmap with specific milestones for each week.\n2. For each week: what to learn, one hands-on exercise, and how to verify I've got it.\n3. The 20% of topics that give 80% of the value (prioritize these).\n4. Common traps that make people quit, and how to avoid them.\n\nKeep it concrete and adjustable. Assume I will actually do it, not just read it.",
      "zh": "请你扮演一位学习教练，为我设计一份切实可行的学习计划。\n\n- 目标：{{我想学会或达成什么}}\n- 当前水平：{{当前水平}}\n- 可用时间：每周 {{每周小时数}} 小时，共 {{周数}} 周\n- 偏好的学习方式：{{阅读_视频_做项目等}}\n\n请输出：\n1. 逐周的学习路线图，每周配有具体的里程碑。\n2. 每一周：学什么、一个动手练习、以及如何验证我已经掌握。\n3. 能带来 80% 价值的那 20% 核心内容（优先安排）。\n4. 让人半途而废的常见坑，以及如何规避。\n\n请保持具体且可调整。请假定我真的会去执行，而不只是读一遍。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "learning-quiz-me-spaced",
    "category": {
      "en": "Learning",
      "zh": "学习"
    },
    "title": {
      "en": "Quiz Me Actively",
      "zh": "主动测验我"
    },
    "body": {
      "en": "Be my quiz master for the topic: {{topic}} (my level: {{level}}).\n\nRules:\n- Ask me ONE question at a time, then wait for my answer before continuing.\n- Mix question types: recall, application, and \"spot the mistake.\"\n- After each of my answers, tell me if I'm right, give a one-line explanation, and adjust the next question's difficulty based on how I did.\n- Every 5 questions, summarize my weak spots and re-ask a varied version of anything I got wrong (spaced repetition).\n\nStart now with question 1. Do not reveal answers before I respond.",
      "zh": "请就主题「{{主题}}」（我的水平：{{水平}}）来当我的出题官。\n\n规则：\n- 一次只问我一道题，问完后等我回答再继续。\n- 题型要混合：记忆题、应用题，以及「找错题」。\n- 我每答完一题，告诉我对错，给一句话解释，并根据我的表现调整下一题的难度。\n- 每 5 题，总结我的薄弱环节，并把我答错过的内容换个说法重新考一遍（间隔重复）。\n\n现在从第 1 题开始。在我作答之前不要透露答案。"
    },
    "source": "Learn Prompting",
    "sourceUrl": "https://learnprompting.org/"
  },
  {
    "id": "learning-eli-code-walkthrough",
    "category": {
      "en": "Learning",
      "zh": "学习"
    },
    "title": {
      "en": "Walk Me Through Code",
      "zh": "逐行讲解代码"
    },
    "body": {
      "en": "Act as a patient programming mentor. Walk me through this code so I understand it well enough to write something similar myself.\n\n```{{language}}\n{{code}}\n```\n\nPlease:\n1. Give a one-sentence summary of what the whole thing does.\n2. Explain it section by section, in execution order, in plain language.\n3. Call out any non-obvious syntax, idioms, or \"why is it written this way\" decisions.\n4. Point out one potential bug, edge case, or improvement.\n5. End with a small exercise that modifies this code to test my understanding.\n\nAssume I know basic programming but am new to {{language_or_concept}}.",
      "zh": "请扮演一位耐心的编程导师，带我逐步读懂这段代码，让我理解到能自己写出类似代码的程度。\n\n```{{语言}}\n{{代码}}\n```\n\n请：\n1. 用一句话概括整段代码的作用。\n2. 按执行顺序、分段用大白话讲解。\n3. 指出任何不显而易见的语法、惯用写法，或「为什么这么写」的设计取舍。\n4. 指出一处潜在的 bug、边界情况或可改进之处。\n5. 最后给一个小练习：让我修改这段代码来检验我的理解。\n\n请假定我懂基础编程，但对「{{语言或概念}}」还是新手。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "learning-language-conversation-partner",
    "category": {
      "en": "Learning",
      "zh": "学习"
    },
    "title": {
      "en": "Language Practice Partner",
      "zh": "语言陪练伙伴"
    },
    "body": {
      "en": "Be my conversation partner for practicing {{target_language}} at a {{level}} level (e.g. A2, B1, intermediate).\n\nRules:\n- Chat with me naturally about {{topic_or_scenario}}, staying roughly at my level.\n- Reply in {{target_language}} first, then give a short {{native_language}} gloss in brackets if a sentence is tricky.\n- After each of my messages, gently correct my mistakes in a separate \"Corrections\" line: show what I wrote, the fixed version, and a one-line reason.\n- Keep the conversation going by asking me a follow-up question every turn.\n- Don't switch fully to {{native_language}} unless I ask.\n\nStart by greeting me and asking the first question.",
      "zh": "请当我的对话伙伴，帮我练习「{{目标语言}}」，难度为 {{水平}}（例如 A2、B1、中级）。\n\n规则：\n- 围绕「{{话题或场景}}」自然地和我聊天，难度大致保持在我的水平。\n- 先用「{{目标语言}}」回复；如果某句较难，在括号里附上简短的「{{母语}}」释义。\n- 我每发一条消息后，在单独的「纠错」一行里温和地纠正我的错误：列出我写的原句、修正版，以及一句话的理由。\n- 每一轮都向我提一个追问，让对话持续下去。\n- 除非我提出要求，否则不要完全切换到「{{母语}}」。\n\n请先用问候语开场，并提出第一个问题。"
    },
    "source": "Awesome ChatGPT Prompts",
    "sourceUrl": "https://github.com/f/awesome-chatgpt-prompts"
  },
  {
    "id": "learning-summarize-to-notes",
    "category": {
      "en": "Learning",
      "zh": "学习"
    },
    "title": {
      "en": "Turn Material Into Notes",
      "zh": "材料转学习笔记"
    },
    "body": {
      "en": "Turn the following material into study notes I can actually learn and review from.\n\nMaterial:\n\"\"\"\n{{paste_article_transcript_or_chapter}}\n\"\"\"\n\nProduce, in this order:\n1. **TL;DR** — 3 sentences capturing the core idea.\n2. **Key points** — a bulleted outline of the main concepts, in logical order.\n3. **Definitions** — any important terms with crisp one-line meanings.\n4. **Examples / takeaways** — concrete examples or practical implications.\n5. **Flashcards** — 5–8 Q&A pairs covering the most testable points.\n6. **Open questions** — anything the material left unclear or worth exploring further.\n\nBe faithful to the source; do not invent facts. Keep it concise.",
      "zh": "请把下面这份材料整理成我真正能学习和复习的笔记。\n\n材料：\n\"\"\"\n{{粘贴文章_文字稿或章节}}\n\"\"\"\n\n请按以下顺序输出：\n1. **一句话总结**——用 3 句话抓住核心思想。\n2. **要点**——按逻辑顺序列出主要概念的提纲。\n3. **术语定义**——重要术语配上简洁的一句话解释。\n4. **例子 / 启示**——具体的例子或实际意义。\n5. **记忆卡片**——5～8 组问答，覆盖最值得考查的要点。\n6. **待解疑问**——材料中没讲清楚、或值得进一步探究的地方。\n\n请忠于原文，不要编造事实，保持简洁。"
    },
    "source": "Anthropic Prompt Library",
    "sourceUrl": "https://docs.anthropic.com/en/prompt-library/library"
  },
  {
    "id": "productivity-weekly-priorities",
    "category": {
      "en": "Productivity",
      "zh": "效率办公"
    },
    "title": {
      "en": "Plan my week",
      "zh": "规划我的一周"
    },
    "body": {
      "en": "Act as my executive assistant. Here is everything on my plate this week:\n\n---\n{{tasks_and_deadlines}}\n---\n\nMy top goal this week is: {{main_goal}}. I have roughly {{hours_available}} focused hours.\n\nDo this:\n1. Sort the items into Do now / Schedule / Delegate or defer / Drop, with a one-line reason each.\n2. Pick the 3 highest-leverage tasks that move my main goal forward.\n3. Lay out a realistic day-by-day plan (Mon–Fri) that fits my available hours and protects deep-work time.\n4. Flag any conflicts, risks, or missing info before I start.",
      "zh": "请做我的行政助理。这是我本周手头的所有事情：\n\n---\n{{任务与截止日期}}\n---\n\n本周我的首要目标是：{{核心目标}}，大约有 {{可用小时数}} 小时的专注时间。\n\n请完成：\n1. 把事项分为「立刻做 / 安排时间 / 委派或推迟 / 放弃」四类，每条给一句话理由。\n2. 选出最能推动核心目标的 3 件高杠杆任务。\n3. 排出周一到周五的现实日程，匹配我的可用时间并保护好深度工作时段。\n4. 在开始前指出任何冲突、风险或缺失的信息。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "productivity-email-reply",
    "category": {
      "en": "Productivity",
      "zh": "效率办公"
    },
    "title": {
      "en": "Reply to this email",
      "zh": "回复这封邮件"
    },
    "body": {
      "en": "Draft a reply to the email below. I want to convey: {{my_key_points}}. Tone: {{tone}} (e.g. warm, firm, neutral-professional).\n\nKeep it concise and skimmable: open with the answer or decision, then any reasoning, then a clear next step or question. Match the sender's level of formality. Do not invent facts I didn't give you; if something is unresolved, leave a [bracketed placeholder] for me. Return subject (if a new one helps) and body only.\n\n--- Original email ---\n{{incoming_email}}",
      "zh": "请帮我起草下面这封邮件的回复。我想传达的要点是：{{我的要点}}。语气：{{语气}}（如温和、坚定、中性专业）。\n\n回复要简短、易扫读：先给出结论或决定，再写必要的理由，最后是明确的下一步或问题。语气正式程度与来信保持一致。不要编造我没提供的事实；若有未定事项，用 [方括号占位符] 留给我填。只返回主题行（如有更好的新主题）和正文。\n\n--- 原始邮件 ---\n{{来信内容}}"
    },
    "source": "Awesome ChatGPT Prompts",
    "sourceUrl": "https://github.com/f/awesome-chatgpt-prompts"
  },
  {
    "id": "productivity-decision-matrix",
    "category": {
      "en": "Productivity",
      "zh": "效率办公"
    },
    "title": {
      "en": "Decision matrix",
      "zh": "决策矩阵"
    },
    "body": {
      "en": "Help me decide between these options: {{options}}.\n\nThe decision is: {{decision_context}}. The criteria I care about (most important first): {{criteria}}.\n\nDo this:\n1. Build a scoring table: rows = options, columns = criteria, each scored 1–5 with a weight reflecting importance.\n2. Compute a weighted total per option and rank them.\n3. Note the key tradeoff and the single biggest risk of the top choice.\n4. Give your recommendation in one sentence, and say what new information would change it.\n\nIf any criterion or option is underspecified, ask me before scoring.",
      "zh": "帮我在这些选项中做选择：{{选项}}。\n\n要决策的是：{{决策背景}}。我看重的标准（按重要性排序）：{{评估标准}}。\n\n请完成：\n1. 构建打分表：行是选项，列是标准，每格按 1–5 打分，并按重要性给各标准设权重。\n2. 计算每个选项的加权总分并排名。\n3. 指出关键取舍，以及最优选项最大的单一风险。\n4. 用一句话给出推荐，并说明什么新信息会改变这个结论。\n\n若有标准或选项交代不清，请先向我提问再打分。"
    },
    "source": "Learn Prompting",
    "sourceUrl": "https://learnprompting.org/"
  },
  {
    "id": "productivity-spreadsheet-formula",
    "category": {
      "en": "Productivity",
      "zh": "效率办公"
    },
    "title": {
      "en": "Spreadsheet formula",
      "zh": "表格公式助手"
    },
    "body": {
      "en": "You are a spreadsheet expert for {{tool}} (e.g. Excel or Google Sheets). I want to: {{what_i_want_to_compute}}.\n\nMy data: {{describe_columns_and_sample}} (e.g. dates in A2:A100, amounts in B2:B100).\n\nGive me:\n1. The exact formula, ready to paste, with cell references matching my layout.\n2. A one-line plain explanation of how it works.\n3. Common pitfalls (e.g. blanks, text-vs-number, locale separators) and how to avoid them.\n\nIf a simpler or more robust approach exists (helper column, pivot table), mention it briefly.",
      "zh": "你是 {{工具}}（如 Excel 或 Google 表格）的高手。我想实现：{{要计算的内容}}。\n\n我的数据：{{描述列与示例}}（如日期在 A2:A100，金额在 B2:B100）。\n\n请给我：\n1. 可直接粘贴的精确公式，单元格引用与我的布局一致。\n2. 一句话讲清公式的原理。\n3. 常见坑（如空值、文本与数字混淆、区域分隔符差异）及规避方法。\n\n若有更简单或更稳健的做法（辅助列、数据透视表），请简要提及。"
    },
    "source": "OpenAI Cookbook",
    "sourceUrl": "https://cookbook.openai.com/"
  },
  {
    "id": "productivity-meeting-agenda",
    "category": {
      "en": "Productivity",
      "zh": "效率办公"
    },
    "title": {
      "en": "Build a meeting agenda",
      "zh": "拟定会议议程"
    },
    "body": {
      "en": "Draft a focused agenda for a {{duration}} meeting about {{topic}} with {{attendees}}.\n\nThe outcome we need by the end: {{desired_outcome}}.\n\nProduce:\n1. A one-line meeting objective and the decision(s) to be made.\n2. Time-boxed agenda items (topic, owner, minutes) that add up to the duration, ordered to hit the outcome.\n3. 2–4 sharp pre-read or prep questions to send attendees beforehand.\n4. A short 'parking lot' note for off-topic items.\n\nKeep it lean — cut anything that doesn't serve the outcome.",
      "zh": "请为一场时长 {{时长}}、主题为 {{主题}}、参会人为 {{参会人}} 的会议拟定一份聚焦的议程。\n\n会议结束时需要达成的结果：{{期望结果}}。\n\n请产出：\n1. 一句话的会议目标，以及需要做出的决定。\n2. 限时的议程项（议题、负责人、分钟数），总时长与会议时长吻合，并按达成结果的顺序排列。\n3. 2–4 个尖锐的会前阅读或准备问题，提前发给参会人。\n4. 一条简短的「待议事项」记录，用于收纳跑题内容。\n\n务必精简——凡不服务于结果的一律删去。"
    },
    "source": "Anthropic Prompt Library",
    "sourceUrl": "https://docs.anthropic.com/en/prompt-library/library"
  },
  {
    "id": "productivity-time-blocking",
    "category": {
      "en": "Productivity",
      "zh": "效率办公"
    },
    "title": {
      "en": "Time-block my day",
      "zh": "时间块排日程"
    },
    "body": {
      "en": "Turn my to-do list into a realistic time-blocked schedule for today.\n\nTasks (with my rough effort estimates if known): {{tasks}}\nFixed commitments: {{fixed_events}}\nMy working window: {{start_time}}–{{end_time}}. Peak focus hours: {{peak_hours}}.\n\nRules:\n- Put demanding/deep-work tasks in my peak hours; batch shallow tasks together.\n- Add short breaks and buffer time; don't overfill — leave ~20% slack.\n- If everything won't fit, tell me what to cut or move to tomorrow and why.\n\nReturn a clean time-blocked timetable, then a one-line note on what I should protect most.",
      "zh": "请把我的待办清单排成今天可执行的时间块日程。\n\n任务（如有粗略工时估计请一并标注）：{{任务清单}}\n固定安排：{{固定事项}}\n我的工作时段：{{开始时间}}–{{结束时间}}。精力高峰时段：{{高峰时段}}。\n\n规则：\n- 把高强度/深度工作放在精力高峰时段；把琐碎任务批量合并。\n- 加入短暂休息和缓冲时间；不要排满——保留约 20% 的余量。\n- 若无法全部装下，告诉我该删减或挪到明天的事项及理由。\n\n返回一份清晰的时间块日程表，并附一句话说明我今天最该守住什么。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "productivity-status-update",
    "category": {
      "en": "Productivity",
      "zh": "效率办公"
    },
    "title": {
      "en": "Write a status update",
      "zh": "撰写进度汇报"
    },
    "body": {
      "en": "Turn my raw notes into a crisp status update for {{audience}} (e.g. my manager, the team, a client).\n\nRaw notes:\n---\n{{progress_notes}}\n---\n\nFormat it as:\n- Status: on track / at risk / blocked (one word + one line of why)\n- Done since last update: bullets, outcome-focused\n- In progress / next: bullets with owners and dates if known\n- Blockers / needs: what I need and from whom\n\nKeep it factual and scannable, lead with what they care about most, and don't pad. Match the formality to the audience.",
      "zh": "请把我的零散笔记整理成一份给 {{汇报对象}}（如我的主管、团队、客户）的简洁进度汇报。\n\n零散笔记：\n---\n{{进展笔记}}\n---\n\n格式如下：\n- 状态：正常推进 / 有风险 / 受阻（一个词 + 一句话原因）\n- 上次汇报以来已完成：列表，聚焦成果\n- 进行中 / 下一步：列表，如有请注明负责人与日期\n- 阻碍 / 需要支持：我需要什么、需要谁配合\n\n内容要真实、可快速扫读，先讲对方最关心的，不要凑字数。正式程度与汇报对象相匹配。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "translation-faithful-translate",
    "category": {
      "en": "Translation & Language",
      "zh": "翻译与语言"
    },
    "title": {
      "en": "Natural Translate",
      "zh": "地道翻译"
    },
    "body": {
      "en": "You are a professional translator and native speaker of {{target_language}}. Translate the text below from {{source_language}} into {{target_language}}.\n\nRules:\n- Preserve the original meaning, tone, and register (formal/casual).\n- Produce fluent, idiomatic {{target_language}} that reads as if written by a native, not a literal word-for-word rendering.\n- Keep proper nouns, code, URLs, and numbers unchanged.\n- Do not add, omit, or explain anything; output the translation only.\n\nText:\n\"\"\"\n{{text}}\n\"\"\"",
      "zh": "你是一名专业译者，且为{{目标语言}}母语者。请把下面的文本从{{源语言}}翻译成{{目标语言}}。\n\n要求：\n- 保留原文的含义、语气和语体（正式/口语）。\n- 译文要流畅、地道，像母语者写的一样，而非逐字直译。\n- 专有名词、代码、网址和数字保持原样。\n- 不要增删或解释任何内容，只输出译文。\n\n文本：\n\"\"\"\n{{文本}}\n\"\"\""
    },
    "source": "Anthropic Prompt Library",
    "sourceUrl": "https://docs.anthropic.com/en/prompt-library/library"
  },
  {
    "id": "translation-localize-tone",
    "category": {
      "en": "Translation & Language",
      "zh": "翻译与语言"
    },
    "title": {
      "en": "Localize For Audience",
      "zh": "本地化改写"
    },
    "body": {
      "en": "Localize the following content from {{source_language}} into {{target_language}} for a {{audience}} audience in {{region}}.\n\nGo beyond literal translation:\n- Adapt idioms, humor, examples, units, currency, and date formats to local conventions.\n- Match the tone of a {{brand_or_style}} brand.\n- Flag any phrase that may be culturally sensitive or untranslatable, and suggest an alternative.\n\nReturn:\n1. The localized text.\n2. A short bullet list of notable adaptations you made.\n\nContent:\n\"\"\"\n{{content}}\n\"\"\"",
      "zh": "请把以下内容从{{源语言}}本地化为面向{{地区}}{{受众}}的{{目标语言}}。\n\n不要止于直译：\n- 将习语、幽默、例子、计量单位、货币和日期格式调整为当地惯例。\n- 语气贴合「{{品牌或风格}}」品牌的调性。\n- 标记任何可能存在文化敏感或难以翻译的表达，并给出替代方案。\n\n请返回：\n1. 本地化后的文本。\n2. 一份简短的要点列表，说明你做了哪些值得注意的调整。\n\n内容：\n\"\"\"\n{{内容}}\n\"\"\""
    },
    "source": "Vesti curated"
  },
  {
    "id": "translation-grammar-proofread",
    "category": {
      "en": "Translation & Language",
      "zh": "翻译与语言"
    },
    "title": {
      "en": "Grammar Proofread",
      "zh": "语法校对"
    },
    "body": {
      "en": "Act as a meticulous proofreader for {{language}}. Correct the text below for grammar, spelling, punctuation, and word choice while preserving the author's voice and meaning.\n\nOutput in two parts:\n1. Corrected text — the clean, final version.\n2. Changes — a table listing each fix as: original phrase | corrected phrase | reason (1 short clause).\n\nDo not rewrite for style beyond what correctness requires.\n\nText:\n\"\"\"\n{{text}}\n\"\"\"",
      "zh": "请担任一名细致的{{语言}}校对员。修正下面文本的语法、拼写、标点和用词错误，同时保留作者的语气和原意。\n\n请分两部分输出：\n1. 修正后的文本——干净的最终版本。\n2. 修改清单——用表格列出每处修改：原表达 | 修改后 | 原因（一句简短说明）。\n\n除纠错所需外，不要为了文风而改写。\n\n文本：\n\"\"\"\n{{文本}}\n\"\"\""
    },
    "source": "Awesome ChatGPT Prompts",
    "sourceUrl": "https://github.com/f/awesome-chatgpt-prompts"
  },
  {
    "id": "translation-language-tutor",
    "category": {
      "en": "Translation & Language",
      "zh": "翻译与语言"
    },
    "title": {
      "en": "Language Conversation Tutor",
      "zh": "语言陪练老师"
    },
    "body": {
      "en": "Be my {{target_language}} conversation tutor at the {{level}} (e.g., A2/B1/intermediate) level. Let's talk about {{topic}}.\n\nIn each turn:\n1. Reply naturally in {{target_language}} (1-3 sentences), then ask me one follow-up question.\n2. If my message had mistakes, add a short \"Corrections\" note showing what I wrote vs. the natural version, with a one-line explanation.\n3. Keep vocabulary appropriate to my level; introduce at most one new useful word per turn and gloss it.\n\nStart by greeting me and asking the first question.",
      "zh": "请做我的{{目标语言}}口语陪练老师，难度为{{水平}}（如 A2/B1/中级）。我们来聊聊{{话题}}。\n\n每轮对话请：\n1. 用{{目标语言}}自然地回复（1-3 句），然后向我提一个追问问题。\n2. 如果我的消息有错误，附上简短的「纠错」：列出我写的 vs. 地道的说法，并用一句话解释。\n3. 词汇量贴合我的水平；每轮最多引入一个有用的新词并加以注释。\n\n请先问候我，并提出第一个问题。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "translation-explain-nuance",
    "category": {
      "en": "Translation & Language",
      "zh": "翻译与语言"
    },
    "title": {
      "en": "Explain Word Nuance",
      "zh": "辨析近义词"
    },
    "body": {
      "en": "In {{language}}, explain the difference between these near-synonyms or confusable terms: {{word_a}} vs {{word_b}} (add more if given).\n\nFor each, cover:\n- Core meaning and connotation (positive/neutral/negative).\n- Typical contexts and register (formal, casual, technical).\n- Common collocations.\n- One natural example sentence with a translation into {{my_language}}.\n\nEnd with a one-line rule of thumb for choosing between them.",
      "zh": "请在{{语言}}中辨析以下这组近义词或易混词：{{词A}} 与 {{词B}}（若有更多请一并辨析）。\n\n对每个词请说明：\n- 核心含义与感情色彩（褒义/中性/贬义）。\n- 常见的使用语境和语体（正式、口语、专业）。\n- 常见搭配。\n- 一个自然的例句，并附上译成{{我的语言}}的翻译。\n\n最后用一句话给出取舍的实用诀窍。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "translation-back-translate-qa",
    "category": {
      "en": "Translation & Language",
      "zh": "翻译与语言"
    },
    "title": {
      "en": "Back-Translation QA",
      "zh": "回译质检"
    },
    "body": {
      "en": "Quality-check a translation using back-translation.\n\nSource ({{source_language}}):\n\"\"\"\n{{source_text}}\n\"\"\"\n\nTranslation ({{target_language}}):\n\"\"\"\n{{translated_text}}\n\"\"\"\n\nSteps:\n1. Back-translate the {{target_language}} version literally into {{source_language}}.\n2. Compare it against the source and list any meaning shifts, omissions, additions, or tone changes.\n3. Rate accuracy and fluency each from 1-5 with a one-line justification.\n4. Provide a corrected {{target_language}} translation only where issues were found.",
      "zh": "请用回译法对一份译文进行质量检查。\n\n原文（{{源语言}}）：\n\"\"\"\n{{原文}}\n\"\"\"\n\n译文（{{目标语言}}）：\n\"\"\"\n{{译文}}\n\"\"\"\n\n步骤：\n1. 把{{目标语言}}译文直译回{{源语言}}。\n2. 与原文对照，列出任何含义偏移、漏译、增译或语气变化。\n3. 分别为准确性和流畅度按 1-5 打分，并各附一句理由。\n4. 仅针对发现问题之处，给出修正后的{{目标语言}}译文。"
    },
    "source": "Learn Prompting",
    "sourceUrl": "https://learnprompting.org/"
  },
  {
    "id": "translation-tech-doc-glossary",
    "category": {
      "en": "Translation & Language",
      "zh": "翻译与语言"
    },
    "title": {
      "en": "Technical Doc Translate",
      "zh": "技术文档翻译"
    },
    "body": {
      "en": "Translate the technical document below from {{source_language}} into {{target_language}} for a {{domain}} (e.g., software, medical, legal) audience.\n\nConstraints:\n- Use industry-standard terminology in {{target_language}}; keep widely-accepted English terms untranslated where that is the convention.\n- Do NOT translate code, commands, variable names, API names, or content inside backticks/code blocks.\n- Preserve Markdown structure, headings, lists, tables, and links.\n- Stay consistent: translate each key term the same way throughout.\n\nAfter the translation, output a glossary table of the key terms used: source term | chosen translation.\n\nDocument:\n\"\"\"\n{{document}}\n\"\"\"",
      "zh": "请把下面的技术文档从{{源语言}}翻译成{{目标语言}}，面向{{领域}}（如软件、医疗、法律）读者。\n\n约束：\n- 使用{{目标语言}}中的行业标准术语；对于约定俗成保留英文的术语，保持英文不译。\n- 不要翻译代码、命令、变量名、API 名称，以及反引号或代码块中的内容。\n- 保留 Markdown 结构、标题、列表、表格和链接。\n- 保持一致：同一关键术语全文统一译法。\n\n译文之后，输出一份关键术语对照表：源术语 | 选定译法。\n\n文档：\n\"\"\"\n{{文档}}\n\"\"\""
    },
    "source": "Vesti curated"
  },
  {
    "id": "marketing-product-launch-plan",
    "category": {
      "en": "Marketing & Growth",
      "zh": "营销增长"
    },
    "title": {
      "en": "Product Launch Plan",
      "zh": "产品发布计划"
    },
    "body": {
      "en": "You are a senior product marketing manager. Build a complete go-to-market launch plan for the following product.\n\nProduct: {{product}}\nTarget audience: {{target_audience}}\nKey differentiator: {{differentiator}}\nLaunch date: {{launch_date}}\nBudget level: {{budget}}\n\nDeliver:\n1. Positioning statement (one sentence) and 3 supporting value props.\n2. Pre-launch (4 weeks): audience warming, waitlist, teaser content, influencer/partner outreach.\n3. Launch week: channels, asset checklist, day-by-day timeline.\n4. Post-launch (4 weeks): retention nudges, social proof collection, paid-scaling triggers.\n5. Top 5 KPIs with concrete targets and how to measure each.\n6. The single biggest risk and a mitigation.\n\nBe specific and actionable. Avoid generic advice.",
      "zh": "你是一位资深产品营销负责人。请为以下产品制定一份完整的上市发布计划。\n\n产品：{{产品}}\n目标人群：{{目标人群}}\n核心差异点：{{差异点}}\n发布日期：{{发布日期}}\n预算量级：{{预算}}\n\n请输出：\n1. 一句话定位，以及 3 条支撑性价值主张。\n2. 预热期（前 4 周）：人群养熟、候补名单、悬念内容、达人/伙伴外联。\n3. 发布周：渠道、物料清单、逐日时间表。\n4. 发布后（4 周）：留存触达、口碑/案例收集、付费放量的触发条件。\n5. 5 个核心 KPI，每个给出具体目标值与衡量方式。\n6. 最大的一个风险及其应对方案。\n\n要具体、可执行，避免泛泛而谈。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "marketing-ad-copy-variants",
    "category": {
      "en": "Marketing & Growth",
      "zh": "营销增长"
    },
    "title": {
      "en": "Ad Copy Variants",
      "zh": "广告文案多版本"
    },
    "body": {
      "en": "Act as a direct-response copywriter. Write high-converting ad copy for the platform below.\n\nProduct/offer: {{product}}\nPlatform: {{platform}}\nTarget audience: {{audience}}\nPrimary benefit: {{benefit}}\nTone: {{tone}}\nLanguage: {{language}}\n\nProduce 5 distinct variants, each using a different angle (e.g. pain-point, social proof, curiosity, urgency, transformation). For each variant give:\n- Headline (within the platform's character limit)\n- Primary text / body\n- A call-to-action\n- The psychological angle used (one line)\n\nThen recommend which variant to test first and why. No emojis unless the platform expects them.",
      "zh": "请扮演效果型文案专家，为以下平台撰写高转化广告文案。\n\n产品/活动：{{产品}}\n投放平台：{{平台}}\n目标人群：{{人群}}\n核心利益点：{{利益点}}\n语气：{{语气}}\n语言：{{语言}}\n\n请产出 5 个不同版本，每个采用不同切入角度（如痛点、口碑背书、好奇心、紧迫感、效果对比）。每个版本包含：\n- 标题（符合平台字数限制）\n- 正文\n- 行动号召（CTA）\n- 所用心理切入点（一句话）\n\n最后推荐优先测试哪一版并说明理由。除非平台习惯，否则不要使用表情符号。"
    },
    "source": "Awesome ChatGPT Prompts",
    "sourceUrl": "https://github.com/f/awesome-chatgpt-prompts"
  },
  {
    "id": "marketing-seo-content-brief",
    "category": {
      "en": "Marketing & Growth",
      "zh": "营销增长"
    },
    "title": {
      "en": "SEO Content Brief",
      "zh": "SEO内容简报"
    },
    "body": {
      "en": "You are an SEO content strategist. Create a detailed content brief for a writer targeting this keyword.\n\nTarget keyword: {{keyword}}\nSearch intent: {{intent}}\nAudience: {{audience}}\nLanguage: {{language}}\n\nDeliver:\n1. Recommended title (under 60 chars) + 2 alternatives.\n2. Meta description (under 155 chars).\n3. Suggested URL slug.\n4. Full H2/H3 outline mapped to the search intent.\n5. 8-12 related keywords and entities to include naturally.\n6. 3 questions to answer (People-Also-Ask style).\n7. Target word count and recommended internal/external link types.\n8. One unique angle so this piece beats the current top results.\n\nKeep it skimmable and ready to hand to a writer.",
      "zh": "你是一位 SEO 内容策略师。请围绕以下关键词，为写手撰写一份详细的内容简报。\n\n目标关键词：{{关键词}}\n搜索意图：{{意图}}\n受众：{{受众}}\n语言：{{语言}}\n\n请输出：\n1. 推荐标题（60 字符内）+ 2 个备选。\n2. Meta 描述（155 字符内）。\n3. 建议的 URL 短链（slug）。\n4. 完整的 H2/H3 大纲，对应搜索意图。\n5. 8-12 个需自然融入的相关关键词与实体。\n6. 3 个需要回答的问题（类似「大家还在搜」）。\n7. 目标字数，以及建议的站内/站外链接类型。\n8. 一个独特切入角度，使本文超越当前排名第一的内容。\n\n排版易扫读，可直接交给写手使用。"
    },
    "source": "Google Prompting Guide",
    "sourceUrl": "https://ai.google.dev/gemini-api/docs/prompting-strategies"
  },
  {
    "id": "marketing-email-nurture-sequence",
    "category": {
      "en": "Marketing & Growth",
      "zh": "营销增长"
    },
    "title": {
      "en": "Email Nurture Sequence",
      "zh": "邮件培育序列"
    },
    "body": {
      "en": "Act as a lifecycle email marketer. Design a {{number}}-email nurture sequence.\n\nGoal: {{goal}}\nAudience / where they entered: {{audience_entry}}\nProduct: {{product}}\nTone: {{tone}}\nLanguage: {{language}}\n\nFor each email in the sequence provide:\n- Send timing (e.g. Day 0, Day 2)\n- The job of this email (one line)\n- Subject line + one A/B alternative\n- Preview text\n- A short body outline (bullets, not full prose)\n- A single clear CTA\n\nEnd with: the success metric for the whole sequence, and one branching idea for people who don't engage.",
      "zh": "请扮演生命周期邮件营销专家，设计一个包含 {{数量}} 封邮件的培育序列。\n\n目标：{{目标}}\n受众/进入来源：{{受众来源}}\n产品：{{产品}}\n语气：{{语气}}\n语言：{{语言}}\n\n序列中每封邮件请给出：\n- 发送时机（如第 0 天、第 2 天）\n- 这封邮件的任务（一句话）\n- 主题行 + 一个 A/B 备选\n- 预览文案\n- 简短正文提纲（要点式，非整段文字）\n- 一个清晰的 CTA\n\n最后给出：整个序列的成功衡量指标，以及针对未互动用户的一个分支策略。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "marketing-customer-persona-builder",
    "category": {
      "en": "Marketing & Growth",
      "zh": "营销增长"
    },
    "title": {
      "en": "Customer Persona Builder",
      "zh": "用户画像构建"
    },
    "body": {
      "en": "You are a customer-research analyst. Build a detailed buyer persona based on the inputs below.\n\nProduct/service: {{product}}\nMarket / category: {{market}}\nWhat I already know: {{known_info}}\nLanguage: {{language}}\n\nProduce one primary persona with:\n1. Name, role, and a one-paragraph snapshot.\n2. Demographics and context (only what's relevant to buying).\n3. Goals and the job they're trying to get done.\n4. Pains, frustrations, and current workarounds.\n5. Buying triggers and objections (with how to handle each objection).\n6. Where they spend attention (channels/communities) and who they trust.\n7. 3 messaging hooks that would resonate, in their own voice.\n\nFlag any assumptions you made and what to validate with real research.",
      "zh": "你是一位用户研究分析师。请基于以下信息构建一份详细的目标用户画像。\n\n产品/服务：{{产品}}\n所在市场/品类：{{市场}}\n我已知的信息：{{已知信息}}\n语言：{{语言}}\n\n请输出一个核心画像，包含：\n1. 姓名、身份角色，以及一段话速写。\n2. 人口属性与背景（仅保留与购买相关的部分）。\n3. 目标，以及他真正想完成的「任务」。\n4. 痛点、困扰，以及当前的替代做法。\n5. 购买触发点与顾虑（并给出每个顾虑的应对话术）。\n6. 注意力分布（渠道/社群）与他所信任的人。\n7. 3 句能打动他的传播钩子，用他自己的口吻。\n\n请标注你做出的假设，以及哪些需要通过真实调研验证。"
    },
    "source": "Anthropic Prompt Library",
    "sourceUrl": "https://docs.anthropic.com/en/prompt-library/library"
  },
  {
    "id": "marketing-social-content-calendar",
    "category": {
      "en": "Marketing & Growth",
      "zh": "营销增长"
    },
    "title": {
      "en": "Social Content Calendar",
      "zh": "社媒内容日历"
    },
    "body": {
      "en": "Act as a social media strategist. Create a 2-week content calendar.\n\nBrand: {{brand}}\nPlatform(s): {{platforms}}\nGoal: {{goal}}\nContent pillars: {{pillars}}\nPosting frequency: {{frequency}}\nLanguage: {{language}}\n\nReturn a table with columns: Day | Platform | Content pillar | Format (e.g. reel, carousel, text) | Hook/first line | Post idea (1-2 sentences) | CTA.\n\nRules:\n- Balance posts across the content pillars.\n- Mix value, engagement, and conversion posts (~60/30/10).\n- Make hooks scroll-stopping and platform-native.\n\nAfter the table, list 3 reusable post templates I can refill next cycle.",
      "zh": "请扮演社媒内容策略师，制定一份为期 2 周的内容日历。\n\n品牌：{{品牌}}\n平台：{{平台}}\n目标：{{目标}}\n内容支柱：{{内容支柱}}\n发布频率：{{频率}}\n语言：{{语言}}\n\n请输出一个表格，列为：日期 | 平台 | 内容支柱 | 形式（如短视频、图文轮播、纯文字）| 钩子/首句 | 内容创意（1-2 句）| CTA。\n\n要求：\n- 各内容支柱均衡分布。\n- 价值类、互动类、转化类内容混搭（约 60/30/10）。\n- 钩子要够「拦截」且符合平台调性。\n\n表格之后，再给出 3 个可复用的内容模板，方便下个周期填充使用。"
    },
    "source": "Vesti curated"
  },
  {
    "id": "marketing-growth-experiment-design",
    "category": {
      "en": "Marketing & Growth",
      "zh": "营销增长"
    },
    "title": {
      "en": "Growth Experiment Design",
      "zh": "增长实验设计"
    },
    "body": {
      "en": "You are a growth lead running a rigorous experimentation process. Help me design a testable growth experiment.\n\nGrowth goal / metric to move: {{metric}}\nCurrent baseline: {{baseline}}\nFunnel stage: {{funnel_stage}}\nWhat we observed / hunch: {{observation}}\nConstraints (traffic, eng time, etc.): {{constraints}}\n\nDeliver in this structure:\n1. Hypothesis: \"We believe [change] will cause [outcome] because [reason].\"\n2. The specific change to ship (kept minimal).\n3. Primary metric + guardrail metrics (so we don't break something else).\n4. Target audience / segment and split.\n5. Sample size or duration needed to call it (rough estimate + assumptions).\n6. What result = ship, iterate, or kill.\n\nThen propose 2 alternative experiments ranked by expected ICE score (Impact, Confidence, Ease).",
      "zh": "你是一位负责严谨实验流程的增长负责人。请帮我设计一个可验证的增长实验。\n\n增长目标/要撬动的指标：{{指标}}\n当前基线：{{基线}}\n所处漏斗环节：{{漏斗环节}}\n我们的观察/直觉：{{观察}}\n约束条件（流量、研发工时等）：{{约束}}\n\n请按以下结构输出：\n1. 假设：「我们认为【某改动】会带来【某结果】，因为【原因】。」\n2. 要上线的具体改动（尽量最小化）。\n3. 主指标 + 护栏指标（避免顾此失彼）。\n4. 目标人群/分层及分流方案。\n5. 得出结论所需的样本量或时长（粗估 + 所依据的假设）。\n6. 何种结果对应：推全 / 迭代 / 砍掉。\n\n最后再提出 2 个备选实验，按 ICE 评分（影响力、信心、易实施度）排序。"
    },
    "source": "Learn Prompting",
    "sourceUrl": "https://learnprompting.org/"
  },
  {
    "id": "expert-senior-code-reviewer",
    "category": {
      "en": "Expert Roles",
      "zh": "专家角色"
    },
    "title": {
      "en": "Senior Code Reviewer",
      "zh": "资深代码审查"
    },
    "body": {
      "en": "You are a senior software engineer doing a rigorous code review. Review the {{language}} code below.\n\nFocus on, in priority order:\n1. Correctness bugs and edge cases\n2. Security vulnerabilities\n3. Performance issues\n4. Readability and maintainability\n5. Naming, style, and idiomatic conventions\n\nFor each finding, output: severity (Critical/Major/Minor/Nit), the exact location, why it matters, and a concrete fix (show corrected code). Do not invent issues to pad the list; if the code is solid, say so. End with a one-line overall verdict.\n\nCode:\n```\n{{code}}\n```",
      "zh": "你是一名资深软件工程师，正在进行严格的代码审查。请审查下面的 {{语言}} 代码。\n\n按以下优先级关注：\n1. 正确性缺陷与边界情况\n2. 安全漏洞\n3. 性能问题\n4. 可读性与可维护性\n5. 命名、风格与惯用写法\n\n每条问题请输出：严重程度（严重/重要/次要/吹毛求疵）、确切位置、为何重要，以及具体修复方案（给出修正后的代码）。不要为凑数而臆造问题；若代码本身扎实，请直说。最后用一句话给出整体结论。\n\n代码：\n```\n{{代码}}\n```"
    },
    "source": "Vesti curated"
  },
  {
    "id": "expert-contract-analyst",
    "category": {
      "en": "Expert Roles",
      "zh": "专家角色"
    },
    "title": {
      "en": "Contract Risk Analyst",
      "zh": "合同风险分析"
    },
    "body": {
      "en": "You are an experienced contract analyst. Review the agreement below from the perspective of {{my_role}} (e.g. the buyer/freelancer/tenant).\n\nProduce:\n1. Plain-English summary of what I'm agreeing to (3-5 bullets)\n2. Red-flag clauses that are unusual, one-sided, or risky — quote the clause, explain the risk, rate it High/Medium/Low\n3. Missing protections I'd normally expect\n4. Specific redline suggestions or questions to raise before signing\n\nBe precise and cite clause numbers. This is general information, not legal advice; flag where I should consult a licensed attorney.\n\nContract:\n{{contract_text}}",
      "zh": "你是一名经验丰富的合同分析师。请站在 {{我的角色}}（如买方／自由职业者／租客）的立场审阅下面的协议。\n\n请输出：\n1. 用大白话概括我将承诺的内容（3-5 条要点）\n2. 异常、单方面或有风险的红线条款——引用原文、说明风险、评级为高／中／低\n3. 我通常应有但本合同缺失的保护性条款\n4. 签署前可提出的具体修改建议或质询问题\n\n请精确并标注条款编号。以上为一般信息而非法律意见；请指出哪些情形我应咨询持牌律师。\n\n合同：\n{{合同正文}}"
    },
    "source": "Vesti curated"
  },
  {
    "id": "expert-personal-finance-advisor",
    "category": {
      "en": "Expert Roles",
      "zh": "专家角色"
    },
    "title": {
      "en": "Personal Finance Coach",
      "zh": "理财规划顾问"
    },
    "body": {
      "en": "Act as a pragmatic personal finance coach. I'll share my situation; help me build a clear plan.\n\nMy situation:\n- Monthly after-tax income: {{income}}\n- Major monthly expenses: {{expenses}}\n- Debts (balance + rate): {{debts}}\n- Savings/investments: {{savings}}\n- Goal: {{goal}}\n\nDo this:\n1. Summarize my cash-flow picture and savings rate\n2. Prioritize next steps (emergency fund, debt payoff order, investing) with reasoning\n3. Give a simple monthly budget allocation\n4. Name the 2-3 highest-impact changes I should make first\n\nUse round numbers, explain tradeoffs plainly, and avoid jargon. This is educational, not licensed financial advice.",
      "zh": "请扮演一位务实的理财规划顾问。我会说明我的情况，请帮我制定清晰的计划。\n\n我的情况：\n- 每月税后收入：{{收入}}\n- 主要每月支出：{{支出}}\n- 负债（余额＋利率）：{{负债}}\n- 储蓄／投资：{{储蓄}}\n- 目标：{{目标}}\n\n请完成：\n1. 概括我的现金流状况与储蓄率\n2. 排出后续行动优先级（应急金、还债顺序、投资），并说明理由\n3. 给出简单的每月预算分配\n4. 点明我应最先做出的 2-3 项影响最大的改变\n\n请使用整数估算、用大白话解释取舍、避免术语。本内容仅供学习参考，不构成持牌理财建议。"
    },
    "source": "Awesome ChatGPT Prompts",
    "sourceUrl": "https://github.com/f/awesome-chatgpt-prompts"
  },
  {
    "id": "expert-medical-explainer",
    "category": {
      "en": "Expert Roles",
      "zh": "专家角色"
    },
    "title": {
      "en": "Plain-Language Health Explainer",
      "zh": "医学科普解读"
    },
    "body": {
      "en": "Act as a careful medical explainer who translates complex health information into plain language. I am not asking for a diagnosis.\n\nExplain the following: {{topic_or_report}}\n\nProvide:\n1. What this means in everyday terms\n2. Why it matters / how it typically works in the body\n3. Common contributing factors and lifestyle considerations\n4. Questions worth asking a doctor\n5. Clear warning signs that warrant prompt medical attention\n\nBe accurate and balanced, avoid alarmism, and do not prescribe treatment or dosages. Always remind me to consult a qualified healthcare professional for personal medical decisions.",
      "zh": "请扮演一位严谨的医学科普者，把复杂的健康信息翻译成通俗语言。我并非请你做诊断。\n\n请解释以下内容：{{主题或报告}}\n\n请提供：\n1. 用日常语言说明这是什么意思\n2. 为什么重要／在体内通常如何运作\n3. 常见诱因与生活方式方面的考量\n4. 值得向医生提出的问题\n5. 需要及时就医的明显警示信号\n\n请准确、客观，避免制造恐慌，不要开具治疗方案或剂量。请始终提醒我：个人医疗决策应咨询合格的医疗专业人员。"
    },
    "source": "Anthropic Prompt Library",
    "sourceUrl": "https://docs.anthropic.com/en/prompt-library/library"
  },
  {
    "id": "expert-interview-coach",
    "category": {
      "en": "Expert Roles",
      "zh": "专家角色"
    },
    "title": {
      "en": "Mock Interview Coach",
      "zh": "模拟面试教练"
    },
    "body": {
      "en": "You are an interview coach for a {{role}} position. Run a realistic mock interview with me.\n\nRules:\n- Ask ONE question at a time and wait for my answer before continuing.\n- Mix behavioral, role-specific technical, and situational questions.\n- After each answer, give brief feedback: what worked, what to improve, and a stronger sample phrasing (especially STAR structure for behavioral ones).\n- Gradually increase difficulty.\n\nContext about me / the job: {{background}}\n\nStart by asking your first question.",
      "zh": "你是一名面试教练，针对 {{岗位}} 职位。请与我进行一场逼真的模拟面试。\n\n规则：\n- 每次只问一个问题，等我回答后再继续。\n- 混合行为面试题、岗位相关的技术题和情境题。\n- 每次回答后给出简短反馈：哪里答得好、哪里需改进，以及更强的示范表达（行为题尤其用 STAR 结构）。\n- 难度逐步提升。\n\n关于我／该职位的背景：{{背景}}\n\n请从你的第一个问题开始。"
    },
    "source": "Awesome ChatGPT Prompts",
    "sourceUrl": "https://github.com/f/awesome-chatgpt-prompts"
  },
  {
    "id": "expert-data-analyst",
    "category": {
      "en": "Expert Roles",
      "zh": "专家角色"
    },
    "title": {
      "en": "Data Analyst",
      "zh": "数据分析专家"
    },
    "body": {
      "en": "Act as a senior data analyst. My goal: {{question}}. My dataset has these columns: {{columns}}.\n\nHelp me by:\n1. Clarifying the precise analytical question and the metric that answers it\n2. Listing the steps to clean and prepare the data (flag likely quality issues)\n3. Recommending the right analysis or chart type and why\n4. Writing ready-to-run code in {{tool}} (e.g. Python/pandas, SQL, Excel) to produce it\n5. Noting common pitfalls and how to sanity-check the result\n\nIf the question is ambiguous or the data is insufficient, say what else you'd need before trusting any conclusion.",
      "zh": "请扮演一名资深数据分析师。我的目标是：{{问题}}。我的数据集包含这些列：{{字段}}。\n\n请帮我：\n1. 厘清确切的分析问题，以及用来回答它的指标\n2. 列出清洗与准备数据的步骤（指出可能的数据质量问题）\n3. 推荐合适的分析方法或图表类型并说明理由\n4. 用 {{工具}}（如 Python/pandas、SQL、Excel）编写可直接运行的代码来实现\n5. 提示常见陷阱以及如何对结果做合理性校验\n\n若问题含糊或数据不足，请说明在采信任何结论之前你还需要什么。"
    },
    "source": "OpenAI Cookbook",
    "sourceUrl": "https://cookbook.openai.com/"
  },
  {
    "id": "expert-ux-product-designer",
    "category": {
      "en": "Expert Roles",
      "zh": "专家角色"
    },
    "title": {
      "en": "UX Product Designer",
      "zh": "产品体验设计师"
    },
    "body": {
      "en": "You are a senior UX/product designer. I want feedback on this design or flow: {{description_or_screenshot_notes}}.\n\nTarget users: {{users}}. Primary goal: {{goal}}.\n\nGive me:\n1. A quick heuristic evaluation (clarity, hierarchy, friction points, accessibility)\n2. The single biggest usability problem and why it hurts the goal\n3. 3-5 concrete, prioritized improvements with the rationale and expected impact\n4. One bolder alternative direction worth prototyping\n\nBe specific and opinionated, reference real UX principles (Fitts's law, hierarchy, progressive disclosure, etc.) where relevant, and keep suggestions actionable rather than generic.",
      "zh": "你是一名资深 UX／产品设计师。我想就以下设计或流程获得反馈：{{描述或截图说明}}。\n\n目标用户：{{用户}}。核心目标：{{目标}}。\n\n请给我：\n1. 一份快速的启发式评估（清晰度、信息层级、阻力点、可访问性）\n2. 最严重的单个可用性问题，以及它为何损害目标\n3. 3-5 条具体且分好优先级的改进建议，附理由与预期影响\n4. 一个更大胆、值得做原型验证的替代方向\n\n请具体而有观点，在相关处引用真实的 UX 原则（费茨定律、信息层级、渐进式披露等），并让建议可落地而非泛泛而谈。"
    },
    "source": "Vesti curated"
  }
];
