import { useEffect, useRef, useState } from 'react'
import { Database, LayoutGrid, Table2, Plus, Trash2 } from 'lucide-react'
import { createDatabaseData, databaseToText, type Block, type DatabaseData, type DatabasePropertyType } from '@neonity/notion-clone-shared'
import { useStore } from '@/store'
import { consumeCellFocus, requestFocus } from '@/lib/caret'

const propertyTypes: Record<DatabasePropertyType, string> = {
  text: '文本', number: '数字', date: '日期', checkbox: '复选框', select: '单选'
}
const fieldClass = 'w-full min-w-0 rounded bg-transparent px-2 py-1.5 outline-none focus:ring-2 focus:ring-ring'

export function DatabaseBlock({ block, registerRef }: {
  block: Block
  registerRef: (el: HTMLElement | null) => void
}): JSX.Element {
  const fallback = useRef(createDatabaseData())
  const data = block.content.database ?? fallback.current
  const root = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [addingProperty, setAddingProperty] = useState(false)
  const [propertyName, setPropertyName] = useState('')
  const [propertyType, setPropertyType] = useState<DatabasePropertyType>('text')
  const [options, setOptions] = useState('未开始,进行中,已完成')

  // Read at event time so quick edits never overwrite one another's fields.
  const commit = (update: (current: DatabaseData) => DatabaseData): void => {
    const current = useStore.getState().blocks.find((b) => b.id === block.id)
    if (!current) return
    const database = update(current.content.database ?? data)
    useStore.getState().updateBlockLocal(block.id, {
      ...current.content, database, text: databaseToText(database)
    })
  }
  useEffect(() => {
    if (consumeCellFocus(block.id)) root.current?.querySelector<HTMLInputElement>('[data-record-cell]')?.focus()
  }, [block.id])

  const addRecord = (): void => {
    const id = crypto.randomUUID()
    setQuery('')
    commit((current) => ({ ...current, records: [...current.records, { id, values: {} }] }))
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-record-id="${id}"] [data-record-cell]`)?.focus())
  }
  const filtered = data.records.filter((record) => data.properties.some((p) =>
    String(record.values[p.id] ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase())))
  const sortProperty = data.properties.find((p) => p.id === data.sort?.propertyId)
  const records = sortProperty ? [...filtered].sort((a, b) => {
    const av = a.values[sortProperty.id] ?? ''
    const bv = b.values[sortProperty.id] ?? ''
    const comparison = av === '' ? (bv === '' ? 0 : 1) : bv === '' ? -1
      : sortProperty.type === 'number' ? Number(av) - Number(bv)
      : String(av).localeCompare(String(bv), 'zh-CN', { numeric: true })
    return comparison * (data.sort?.direction === 'desc' ? -1 : 1)
  }) : filtered

  // Both views edit the same records through the same controls.
  const renderCell = (record: DatabaseData['records'][number], property: DatabaseData['properties'][number]): JSX.Element => {
    const value = record.values[property.id]
    const write = (next: string | boolean): void => commit((current) => ({ ...current,
      records: current.records.map((r) => r.id === record.id ? { ...r, values: { ...r.values, [property.id]: next } } : r)
    }))
    const label = `${property.name}，记录 ${data.records.indexOf(record) + 1}`
    return property.type === 'checkbox' ? <input data-record-cell type="checkbox" aria-label={label} className="mx-2 h-4 w-4 accent-foreground"
      checked={value === true} onChange={(e) => write(e.target.checked)} />
      : property.type === 'select' ? <select data-record-cell aria-label={label} className={`${fieldClass} bg-background`} value={String(value ?? '')}
        onChange={(e) => write(e.target.value)}><option value="">未选择</option>{property.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select>
      : <input data-record-cell aria-label={label} placeholder={property.type === 'text' ? '未填写' : undefined} className={fieldClass} type={property.type === 'text' ? 'text' : property.type}
        step={property.type === 'number' ? 'any' : undefined} value={String(value ?? '')} onChange={(e) => write(e.target.value)} />
  }
  const gallery = data.view === 'gallery'
  const titleProperty = data.properties.find((p) => p.type === 'text')

  return (
    <div ref={(el) => { root.current = el; registerRef(el) }} tabIndex={0}
      role="group" aria-label="数据库块"
      onFocus={(e) => {
        if (e.target === e.currentTarget) root.current?.querySelector<HTMLInputElement>('[data-record-cell]')?.focus()
      }}
      className="my-2 min-w-0 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-ring">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input aria-label="数据库名称" className={`${fieldClass} !w-48 font-semibold`} value={data.name}
          onChange={(e) => commit((current) => ({ ...current, name: e.target.value }))} />
        <span className="text-xs text-muted-foreground">{records.length} / {data.records.length} 条记录</span>
        <div role="group" aria-label="数据库视图" className="flex rounded-md border p-0.5">
          {([{ view: 'table', label: '表格', icon: Table2 }, { view: 'gallery', label: '画廊', icon: LayoutGrid }] as const).map(({ view, label, icon: Icon }) =>
            <button key={view} aria-pressed={(data.view ?? 'table') === view}
              className={`flex items-center gap-1 rounded px-2 py-1 ${(data.view ?? 'table') === view ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              onClick={() => commit((current) => ({ ...current, view }))}><Icon className="h-3.5 w-3.5" />{label}</button>)}
        </div>
        <input aria-label="搜索数据库" placeholder="搜索记录…" className={`${fieldClass} !w-36 sm:ml-auto`}
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="排序属性" className="rounded border bg-background p-1.5" value={data.sort?.propertyId ?? ''}
          onChange={(e) => commit((current) => ({ ...current, sort: e.target.value ? { propertyId: e.target.value, direction: current.sort?.direction ?? 'asc' } : undefined }))}>
          <option value="">默认顺序</option>
          {data.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {data.sort && <button className="rounded px-2 py-1 hover:bg-accent" onClick={() => commit((current) => ({
          ...current, sort: current.sort && { ...current.sort, direction: current.sort.direction === 'asc' ? 'desc' : 'asc' }
        }))}>{data.sort.direction === 'asc' ? '升序 ↑' : '降序 ↓'}</button>}
      </div>
      {gallery ? <div className="p-3">
        <div className="mb-3 flex justify-end"><button className="rounded px-2 py-1 text-muted-foreground hover:bg-accent"
          onClick={() => setAddingProperty(!addingProperty)}>＋ 添加属性</button></div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
          {records.map((record) => <article key={record.id} data-record-id={record.id}
            aria-label={String((titleProperty && record.values[titleProperty.id]) || '未命名记录')}
            className="min-w-0 overflow-hidden rounded-lg border bg-background shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring hover:shadow-md">
            <div className="flex items-center gap-2 border-b bg-muted/40 p-3">
              <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 font-semibold">{titleProperty ? renderCell(record, titleProperty) : '未命名记录'}</div>
              <button aria-label={`删除记录 ${data.records.indexOf(record) + 1}`} className="rounded p-1 text-muted-foreground hover:bg-accent"
                onClick={() => {
                  if (window.confirm('删除这条记录？')) commit((current) => ({ ...current, records: current.records.filter((r) => r.id !== record.id) }))
                }}><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2 p-3">{data.properties.filter((p) => p.id !== titleProperty?.id).map((property) =>
              <div key={property.id} className="min-w-0">
                <div className="px-2 text-xs text-muted-foreground">{property.name}</div>
                {renderCell(record, property)}
              </div>)}</div>
          </article>)}
        </div>
        {records.length === 0 && <p className="p-5 text-center text-muted-foreground">{query ? '没有匹配的记录' : '暂无记录，添加第一条记录'}</p>}
      </div> : <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-muted/40"><tr>
            {data.properties.map((property) => <th key={property.id} className="min-w-[160px] border-b border-r p-1 font-normal">
              <div className="flex items-center">
                <input aria-label={`属性名称：${property.name}`} className={`${fieldClass} font-medium`} value={property.name}
                  onChange={(e) => commit((current) => ({ ...current, properties: current.properties.map((p) => p.id === property.id ? { ...p, name: e.target.value } : p) }))} />
                <button aria-label={`删除属性：${property.name}`} disabled={data.properties.length <= 1}
                  className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  onClick={() => {
                    if (!window.confirm(`删除属性“${property.name}”及其所有值？`)) return
                    commit((current) => ({ ...current,
                      properties: current.properties.filter((p) => p.id !== property.id),
                      records: current.records.map((r) => ({ ...r, values: Object.fromEntries(Object.entries(r.values).filter(([id]) => id !== property.id)) })),
                      sort: current.sort?.propertyId === property.id ? undefined : current.sort
                    }))
                  }}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              <span className="px-2 text-xs text-muted-foreground">{propertyTypes[property.type]}</span>
            </th>)}
            <th className="min-w-[100px] border-b p-2 font-normal"><button className="whitespace-nowrap text-muted-foreground hover:text-foreground"
              onClick={() => setAddingProperty(!addingProperty)}>＋ 添加属性</button></th>
          </tr></thead>
          <tbody>{records.map((record) => <tr key={record.id} data-record-id={record.id} className="hover:bg-muted/20">
            {data.properties.map((property) => <td key={property.id} className="border-b border-r p-1">{renderCell(record, property)}</td>)}
            <td className="border-b p-2"><button aria-label={`删除记录 ${data.records.indexOf(record) + 1}`} className="rounded p-1 text-muted-foreground hover:bg-accent"
              onClick={() => {
                if (window.confirm('删除这条记录？')) commit((current) => ({ ...current, records: current.records.filter((r) => r.id !== record.id) }))
              }}><Trash2 className="h-4 w-4" /></button></td>
          </tr>)}</tbody>
        </table>
        {records.length === 0 && <p className="p-5 text-center text-muted-foreground">{query ? '没有匹配的记录' : '暂无记录，添加第一条记录'}</p>}
      </div>}
      {addingProperty && <form className="flex flex-wrap gap-2 border-b bg-muted/20 p-3" onSubmit={(e) => {
        e.preventDefault()
        if (!propertyName.trim()) return
        commit((current) => ({ ...current, properties: [...current.properties, {
          id: crypto.randomUUID(), name: propertyName.trim(), type: propertyType,
          options: propertyType === 'select' ? [...new Set(options.split(/[,，\n]/).map((v) => v.trim()).filter(Boolean))] : undefined
        }] }))
        setPropertyName(''); setAddingProperty(false)
      }}>
        <input required aria-label="新属性名称" placeholder="属性名称" className="rounded border bg-background px-2 py-1" value={propertyName} onChange={(e) => setPropertyName(e.target.value)} />
        <select aria-label="属性类型" className="rounded border bg-background px-2" value={propertyType} onChange={(e) => setPropertyType(e.target.value as DatabasePropertyType)}>
          {Object.entries(propertyTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {propertyType === 'select' && <input aria-label="单选选项" placeholder="选项，用逗号分隔" className="rounded border bg-background px-2 py-1" value={options} onChange={(e) => setOptions(e.target.value)} />}
        <button type="submit" className="rounded bg-primary px-3 py-1 text-primary-foreground">添加</button>
        <button type="button" onClick={() => setAddingProperty(false)}>取消</button>
      </form>}
      <div className="flex items-center gap-4 p-2 text-muted-foreground">
        <button className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent" onClick={addRecord}><Plus className="h-4 w-4" />新增记录</button>
        <button className="ml-auto rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => {
          void useStore.getState().insertBlockAfter(block.id, 'paragraph', { text: '' }).then((next) => { if (next) requestFocus(next.id, 0) })
        }}>在下方继续写作</button>
      </div>
    </div>
  )
}
