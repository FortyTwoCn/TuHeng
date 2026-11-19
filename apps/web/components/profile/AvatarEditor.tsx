'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  avatarCropBox,
  AVATAR_MAX_BYTES,
  AVATAR_MAX_PIXELS,
  type AuthRealm,
  type AvatarCrop,
} from '@tuheng/contracts';
import { AccountAvatar } from './AccountAvatar';
import { Dialog } from '../identity/Dialog';
import { identityMessage } from '../identity/client';

const center: AvatarCrop = { x: 0.5, y: 0.5, zoom: 1 };
export function AvatarEditor({
  name,
  realm,
  version,
  revision,
}: {
  name: string;
  realm: AuthRealm;
  version: string | null;
  revision: number;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [crop, setCrop] = useState<AvatarCrop>(center);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      if (width * height > AVATAR_MAX_PIXELS || !width || !height)
        setError(identityMessage('INVALID_AVATAR_IMAGE'));
      else {
        setDimensions({ width, height });
        setUrl(objectUrl);
      }
    };
    image.onerror = () => setError(identityMessage('INVALID_AVATAR_IMAGE'));
    image.src = objectUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  function close() {
    setFile(undefined);
    setUrl('');
    setDimensions(undefined);
    setCrop(center);
    setError('');
  }
  async function save(remove: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const form = new FormData();
      if (file) form.set('file', file);
      form.set('revision', String(revision));
      form.set('crop', JSON.stringify(crop));
      const response = await fetch('/api/profile/avatar', {
        method: remove ? 'DELETE' : 'POST',
        headers: {
          'x-tuheng-realm': realm,
          ...(remove ? { 'Content-Type': 'application/json' } : {}),
        },
        body: remove ? JSON.stringify({ revision }) : form,
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) router.refresh();
        throw new Error(identityMessage(body.error ?? '上传未完成，请重试。'));
      }
      close();
      setMessage(remove ? '已恢复默认头像。' : '头像已更新。');
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const box = dimensions && avatarCropBox(dimensions.width, dimensions.height, crop);
  return (
    <div className="avatar-editor">
      <AccountAvatar name={name} realm={realm} version={version} large />
      <div>
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Camera size={17} aria-hidden="true" /> {version ? '更换头像' : '上传头像'}
          </button>
          {version && (
            <button
              type="button"
              className="button ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm('移除当前头像并恢复默认头像？')) void save(true);
              }}
            >
              <Trash2 size={16} aria-hidden="true" /> 移除头像
            </button>
          )}
        </div>
        <p className="muted small">静态 JPEG、PNG 或 WebP，最大 5 MB、1600 万像素。</p>
        {message && (
          <p role="status" className="account-success">
            {message}
          </p>
        )}
        {!file && error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择头像图片"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          e.target.value = '';
          if (!selected) return;
          setMessage('');
          close();
          if (selected.size > AVATAR_MAX_BYTES) setError(identityMessage('AVATAR_SIZE_LIMIT'));
          else setFile(selected);
        }}
      />
      <Dialog
        open={!!file}
        title="调整头像"
        onClose={close}
        busy={busy}
        className="avatar-crop-dialog"
      >
        {dimensions && box && url && (
          <>
            <div className="avatar-crop-window" aria-label="头像裁切预览">
              <img
                src={url}
                alt="裁切预览"
                style={{
                  width: (dimensions.width / box.edge) * 100 + '%',
                  height: (dimensions.height / box.edge) * 100 + '%',
                  left: (-box.left / box.edge) * 100 + '%',
                  top: (-box.top / box.edge) * 100 + '%',
                }}
              />
            </div>
            <div className="avatar-crop-controls">
              {(
                [
                  ['zoom', '缩放', 1, 4],
                  ['x', '左右位置', 0, 1],
                  ['y', '上下位置', 0, 1],
                ] as const
              ).map(([key, label, min, max]) => (
                <label key={key}>
                  {label}
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={0.01}
                    disabled={busy}
                    value={crop[key]}
                    onChange={(e) => setCrop({ ...crop, [key]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={busy || !dimensions}
            onClick={() => void save(false)}
          >
            {busy ? '正在保存…' : '保存头像'}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
