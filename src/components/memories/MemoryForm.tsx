import { ImagePlus, X } from 'lucide-react';
import { useState } from 'react';
import type React from 'react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { Memory, MemoryDraft } from '../../types';
import { auth } from '../../lib/firebase';
import { storage } from '../../lib/firebaseStorage';
import { localDateKey } from '../../utils/dates';

const isVideo = (src: string) => src.startsWith('data:video/') || /\.(mp4|webm|mov)(\?|$)/i.test(src);
const safeFileName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'media';

export function MemoryForm({ memory, draft, onSave, onClose }: { memory?: Memory; draft?: MemoryDraft; onSave: (memory: Memory) => void; onClose: () => void }) {
  const [title, setTitle] = useState(memory?.title ?? draft?.title ?? '');
  const [date, setDate] = useState(memory?.date ?? draft?.date ?? localDateKey());
  const [description, setDescription] = useState(memory?.description ?? draft?.description ?? '');
  const [location, setLocation] = useState(memory?.location ?? draft?.location ?? '');
  const [tags, setTags] = useState(memory?.tags?.join(', ') ?? draft?.tags?.join(', ') ?? '');
  const [images, setImages] = useState(memory?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const addMedia = async (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setUploadError('로그인 정보를 확인한 뒤 다시 시도해 주세요.');
      return;
    }

    setUploading(true);
    setUploadError('');
    try {
      const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const uploaded = await Promise.all(selected.map(async (file, index) => {
        const target = ref(storage, `users/${uid}/backupMedia/memories/uploads/${batchId}-${index}-${safeFileName(file.name)}`);
        await uploadBytes(target, file, { contentType: file.type || undefined });
        return getDownloadURL(target);
      }));
      setImages((items) => [...items, ...uploaded]);
    } catch (error) {
      console.error('[ROUTE memory media upload]', error);
      setUploadError('사진 또는 영상을 업로드하지 못했어요. 네트워크 상태를 확인하고 다시 시도해 주세요.');
    } finally {
      setUploading(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !images.length || uploading) return;
    onSave({
      id: memory?.id ?? Date.now(),
      title: title.trim(),
      date,
      description: description.trim(),
      images,
      location: location.trim() || undefined,
      tags: tags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean),
      createdBy: memory?.createdBy ?? 'me',
      favorite: memory?.favorite ?? false,
    });
  };

  return <div className="sheet-backdrop" role="dialog" aria-modal="true"><form className="memory-form" onSubmit={submit}><header><div><small>{memory ? 'EDIT MEMORY' : draft ? 'FROM LOCATION' : 'NEW MEMORY'}</small><h2>{memory ? '추억 수정' : draft ? '방문 장소에서 추억 만들기' : '추억 추가'}</h2></div><button type="button" onClick={onClose} aria-label="닫기"><X /></button></header>{draft && !memory && <p className="memory-flow-hint">장소와 날짜를 미리 채워뒀어요. 사진이나 영상을 추가하면 추억으로 저장할 수 있어요.</p>}<label>제목<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="어떤 순간이었나요?" required /></label><label>날짜<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label className="photo-field">사진 또는 영상<input type="file" accept="image/*,video/*" multiple disabled={uploading} onChange={(event) => void addMedia(event.target.files)} /><span><ImagePlus size={18} />{uploading ? '미디어 업로드 중...' : `미디어 선택 (${images.length})`}</span></label>{uploadError && <p className="memory-upload-error" role="alert">{uploadError}</p>}{!!images.length && <div className="form-thumbnails">{images.map((item, index) => isVideo(item) ? <video src={item} muted playsInline preload="metadata" key={`${item.slice(0, 30)}-${index}`} /> : <img src={item} alt={`선택 미디어 ${index + 1}`} key={`${item.slice(0, 30)}-${index}`} />)}</div>}<label>설명<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="그날의 이야기를 남겨주세요" rows={3} /></label><label>장소<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="예: 서울숲" /></label><label>태그<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="여행, 산책 (쉼표로 구분)" /></label><button className="primary" type="submit" disabled={!title.trim() || !images.length || uploading}>{uploading ? '업로드 중...' : memory ? '변경사항 저장' : '추억 저장'}</button></form></div>;
}
