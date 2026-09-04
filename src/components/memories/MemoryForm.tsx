import { ImagePlus, X } from 'lucide-react';
import { useState } from 'react';
import type React from 'react';
import type { Memory } from '../../types';
import { localDateKey } from '../../utils/dates';

const isVideo = (src: string) => src.startsWith('data:video/') || /\.(mp4|webm|mov)(\?|$)/i.test(src);

export function MemoryForm({ memory, onSave, onClose }: { memory?: Memory; onSave: (memory: Memory) => void; onClose: () => void }) {
  const [title, setTitle] = useState(memory?.title ?? '');
  const [date, setDate] = useState(memory?.date ?? localDateKey());
  const [description, setDescription] = useState(memory?.description ?? '');
  const [location, setLocation] = useState(memory?.location ?? '');
  const [tags, setTags] = useState(memory?.tags?.join(', ') ?? '');
  const [images, setImages] = useState(memory?.images ?? []);
  const addMedia = async (files: FileList | null) => {
    const encoded = await Promise.all(Array.from(files ?? []).map((file) => new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    })));
    setImages((items) => [...items, ...encoded]);
  };
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!title.trim() || !images.length) return; onSave({ id: memory?.id ?? Date.now(), title: title.trim(), date, description: description.trim(), images, location: location.trim() || undefined, tags: tags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean), createdBy: memory?.createdBy ?? 'me', favorite: memory?.favorite ?? false }); };
  return <div className="sheet-backdrop" role="dialog" aria-modal="true"><form className="memory-form" onSubmit={submit}><header><div><small>{memory ? 'EDIT MEMORY' : 'NEW MEMORY'}</small><h2>{memory ? '추억 수정' : '추억 추가'}</h2></div><button type="button" onClick={onClose} aria-label="닫기"><X /></button></header><label>제목<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="어떤 순간이었나요?" required /></label><label>날짜<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label className="photo-field">사진 또는 영상<input type="file" accept="image/*,video/*" multiple onChange={(event) => void addMedia(event.target.files)} /><span><ImagePlus size={18} />미디어 선택 ({images.length})</span></label>{!!images.length && <div className="form-thumbnails">{images.map((item, index) => isVideo(item) ? <video src={item} muted playsInline preload="metadata" key={`${item.slice(0, 30)}-${index}`} /> : <img src={item} alt={`선택 미디어 ${index + 1}`} key={`${item.slice(0, 30)}-${index}`} />)}</div>}<label>설명<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="그날의 이야기를 남겨주세요" rows={3} /></label><label>장소<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="예: 서울숲" /></label><label>태그<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="여행, 산책 (쉼표로 구분)" /></label><button className="primary" type="submit" disabled={!title.trim() || !images.length}>{memory ? '변경사항 저장' : '추억 저장'}</button></form></div>;
}
