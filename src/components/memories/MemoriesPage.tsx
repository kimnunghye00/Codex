import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type React from 'react';
import type { Memory } from '../../types';
import { MemoryCard } from './MemoryCard';
import { MemoryDetail } from './MemoryDetail';
import { MemoryForm } from './MemoryForm';

type Filter = 'all' | 'favorite' | string;

export function MemoriesPage({ Header, memories, setMemories, initialMemoryId, onClearInitial }: { Header: ({ title }: { title?: string }) => React.ReactNode; memories: Memory[]; setMemories: React.Dispatch<React.SetStateAction<Memory[]>>; initialMemoryId?: number; onClearInitial: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<number | undefined>(initialMemoryId);
  const [editing, setEditing] = useState<Memory | null>();
  const years = useMemo(() => [...new Set(memories.map((memory) => memory.date.slice(0, 4)))].sort().reverse(), [memories]);
  const shown = memories.filter((memory) => filter === 'all' || filter === 'favorite' && memory.favorite || memory.date.startsWith(filter));
  const selectedMemory = memories.find((memory) => memory.id === selected);
  const update = (memory: Memory) => setMemories((items) => items.some((item) => item.id === memory.id) ? items.map((item) => item.id === memory.id ? memory : item) : [memory, ...items]);
  const favorite = (id: number) => setMemories((items) => items.map((item) => item.id === id ? { ...item, favorite: !item.favorite } : item));
  if (selectedMemory) return <><MemoryDetail memory={selectedMemory} onBack={() => { setSelected(undefined); onClearInitial(); }} onFavorite={() => favorite(selectedMemory.id)} onEdit={() => setEditing(selectedMemory)} onDelete={() => { setMemories((items) => items.filter((item) => item.id !== selectedMemory.id)); setSelected(undefined); }} />{editing && <MemoryForm memory={editing} onClose={() => setEditing(undefined)} onSave={(memory) => { update(memory); setEditing(undefined); }} />}</>;
  return <div className="page memories-page"><Header title="추억" /><div className="title-block"><small>BETWEEN US</small><h1>우리의 추억</h1><p>함께한 순간들을 모아봤어요.</p></div><div className="memory-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체</button><button className={filter === 'favorite' ? 'active' : ''} onClick={() => setFilter('favorite')}>즐겨찾기</button>{years.map((year) => <button key={year} className={filter === year ? 'active' : ''} onClick={() => setFilter(year)}>{year}</button>)}</div><div className="memory-list">{shown.map((memory) => <MemoryCard key={memory.id} memory={memory} onOpen={() => setSelected(memory.id)} onFavorite={() => favorite(memory.id)} />)}{!shown.length && <div className="memory-empty">이 필터에 해당하는 추억이 아직 없어요.</div>}</div><button className="fab" onClick={() => setEditing(null)}><Plus size={18} />추억 추가</button>{editing !== undefined && <MemoryForm memory={editing ?? undefined} onClose={() => setEditing(undefined)} onSave={(memory) => { update(memory); setEditing(undefined); setSelected(memory.id); }} />}</div>;
}
