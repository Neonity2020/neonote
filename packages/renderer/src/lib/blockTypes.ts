import {
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Music2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Table2,
  Database,
  Type,
  type LucideIcon
} from 'lucide-react'
import type { BlockType } from '@neonity/neonote-shared'

/** One entry of the block type catalogue, as shown in the slash menu. */
export interface BlockTypeMeta {
  type: BlockType
  label: string
  description: string
  /**
   * Extra search aliases: the pinyin of the label plus common English
   * synonyms, so the slash menu can be filtered in several ways.
   */
  keywords: string
  icon: LucideIcon
}

/** The block types offered by the slash menu, in display order. */
export const BLOCK_TYPE_ITEMS: BlockTypeMeta[] = [
  { type: 'database', label: '数据库', description: '带属性、记录和排序的数据库', keywords: 'database db shujuku sjk', icon: Database },
  { type: 'paragraph', label: '正文', description: '普通段落文本', keywords: 'text plain zw zhengwen p', icon: Type },
  { type: 'heading1', label: '标题 1', description: '最大级别标题', keywords: 'h1 heading bt biaoti', icon: Heading1 },
  { type: 'heading2', label: '标题 2', description: '中等级别标题', keywords: 'h2 heading bt biaoti', icon: Heading2 },
  { type: 'heading3', label: '标题 3', description: '小节标题', keywords: 'h3 heading bt biaoti', icon: Heading3 },
  { type: 'bulletedList', label: '无序列表', description: '项目符号列表项', keywords: 'ul bullet list wx lb', icon: List },
  { type: 'numberedList', label: '有序列表', description: '自动编号列表项', keywords: 'ol number yx lb', icon: ListOrdered },
  { type: 'todo', label: '待办事项', description: '可勾选的任务项', keywords: 'todo task check db sx', icon: CheckSquare },
  { type: 'quote', label: '引用', description: '引用或强调文字', keywords: 'quote blockquote yy yin', icon: Quote },
  { type: 'code', label: '代码块', description: '等宽字体代码片段', keywords: 'code pre dm daima', icon: Code },
  { type: 'image', label: '图片', description: '插入本地图片或直接粘贴', keywords: 'image picture img photo tp tupian', icon: Image },
  { type: 'audio', label: '音频', description: '嵌入音频链接并播放', keywords: 'audio music sound mp3 yinpin yp yinyue', icon: Music2 },
  { type: 'table', label: '表格', description: '简单的行列数据表', keywords: 'table grid biaoge bg bg2 liebiao', icon: Table2 },
  { type: 'divider', label: '分割线', description: '水平分隔线', keywords: 'divider hr fgx line', icon: Minus }
]

/** Lookup from a block type to its catalogue entry. */
export const BLOCK_TYPE_MAP = new Map<BlockType, BlockTypeMeta>(
  BLOCK_TYPE_ITEMS.map((item) => [item.type, item])
)

/** Filter the catalogue by label, description or keyword alias, case-insensitively. */
export function filterBlockTypes(filter: string): BlockTypeMeta[] {
  const f = filter.trim().toLowerCase()
  if (!f) return BLOCK_TYPE_ITEMS
  return BLOCK_TYPE_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(f) ||
      item.description.toLowerCase().includes(f) ||
      item.keywords.toLowerCase().includes(f)
  )
}

/** Placeholder text shown in an empty block of the given type. */
export function placeholderFor(type: BlockType): string {
  switch (type) {
    case 'heading1':
      return '标题 1'
    case 'heading2':
      return '标题 2'
    case 'heading3':
      return '标题 3'
    case 'todo':
      return '待办事项'
    case 'bulletedList':
    case 'numberedList':
      return '列表项'
    case 'quote':
      return '引用'
    case 'image':
      return '图片'
    case 'audio':
      return '音频链接'
    default:
      return "输入正文,按 '/' 唤起命令菜单"
  }
}
