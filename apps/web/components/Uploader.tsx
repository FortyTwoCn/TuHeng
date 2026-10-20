'use client';
import { useRef, useState } from 'react';
import { UploadCloud, ArrowUp, ArrowDown, Trash2, RotateCw, Camera } from 'lucide-react';
import { action } from './Actions';
export interface UploadedAsset {
  id: string;
  name: string;
  mime: string;
}
export function Uploader({
  value,
  onChange,
  purpose = 'SUBMISSION',
  label = '上传作答图纸',
}: {
  value: UploadedAsset[];
  onChange: (v: UploadedAsset[]) => void;
  purpose?: string;
  label?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null),
    cameraRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null),
    [error, setError] = useState(''),
    [failed, setFailed] = useState<File[]>([]);
  async function upload(files: File[]) {
    setError('');
    const next = [...value],
      fail: File[] = [];
    for (const file of files) {
      if (next.length >= 10) {
        setError('每组最多10张图');
        break;
      }
      try {
        const asset = await new Promise<UploadedAsset>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/assets');
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            try {
              const r = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) resolve(r);
              else reject(new Error(r.error ?? '上传失败'));
            } catch {
              reject(new Error('上传响应无效'));
            }
          };
          xhr.onerror = () => reject(new Error('网络中断，请重试'));
          xhr.timeout = 120000;
          xhr.ontimeout = () => reject(new Error('上传超时'));
          const form = new FormData();
          form.set('file', file);
          form.set('purpose', purpose);
          xhr.send(form);
        });
        next.push(asset);
        onChange([...next]);
      } catch (e) {
        fail.push(file);
        setError((e as Error).message);
      }
    }
    setFailed(fail);
    setProgress(null);
  }
  const accept =
    purpose === 'SUBMISSION' ? 'image/jpeg,image/png' : 'image/jpeg,image/png,application/pdf';
  return (
    <div className="uploader">
      <div
        className="upload-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (progress === null) upload([...e.dataTransfer.files]);
        }}
      >
        <UploadCloud size={30} />
        <strong>{label}</strong>
        <p>
          拖放文件，或选择本地文件 · JPG / PNG{purpose !== 'SUBMISSION' ? ' / PDF' : ''} ·
          单个不超过15MB
        </p>
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            disabled={progress !== null}
            onClick={() => fileRef.current?.click()}
          >
            选择文件
          </button>
          <button
            type="button"
            className="button ghost"
            disabled={progress !== null}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera size={16} />
            拍照上传
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          multiple
          hidden
          aria-label={label}
          onChange={(e) => {
            upload([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label="拍照上传"
          onChange={(e) => upload([...(e.target.files ?? [])])}
        />
        {progress !== null && (
          <div role="status">
            <progress max={100} value={progress} />
            <span>正在上传 {progress}%</span>
          </div>
        )}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}{' '}
          {failed.length > 0 && (
            <button type="button" onClick={() => upload(failed)}>
              重试失败文件
            </button>
          )}
        </div>
      )}
      <div className="upload-grid">
        {value.map((asset, index) => (
          <div className="uploaded" key={asset.id}>
            {asset.mime === 'application/pdf' ? (
              <a href={`/api/assets/${asset.id}`} target="_blank">
                PDF · 点击预览
              </a>
            ) : (
              <img src={`/api/assets/${asset.id}`} alt={asset.name} />
            )}
            <span>
              {index + 1}. {asset.name}
            </span>
            <div className="icon-row">
              <button
                type="button"
                aria-label="向前排序"
                disabled={index === 0}
                onClick={() => {
                  const next = [...value];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  onChange(next);
                }}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                aria-label="向后排序"
                disabled={index === value.length - 1}
                onClick={() => {
                  const next = [...value];
                  [next[index], next[index + 1]] = [next[index + 1], next[index]];
                  onChange(next);
                }}
              >
                <ArrowDown size={16} />
              </button>
              {asset.mime !== 'application/pdf' && (
                <button
                  type="button"
                  aria-label="旋转图纸"
                  onClick={async () => {
                    try {
                      const rotated = await action('asset-transform', {
                        id: asset.id,
                        rotate: 90,
                        crop: null,
                      });
                      onChange(value.map((a) => (a.id === asset.id ? rotated : a)));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <RotateCw size={16} />
                </button>
              )}
              <button
                type="button"
                aria-label="移除文件"
                onClick={() => onChange(value.filter((a) => a.id !== asset.id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {asset.mime !== 'application/pdf' && (
              <details>
                <summary>人工裁切</summary>
                <CropControls
                  onCrop={async (crop) => {
                    try {
                      const cropped = await action('asset-transform', {
                        id: asset.id,
                        rotate: 0,
                        crop,
                      });
                      onChange(value.map((a) => (a.id === asset.id ? cropped : a)));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CropControls({
  onCrop,
}: {
  onCrop: (crop: { left: number; top: number; width: number; height: number }) => Promise<void>;
}) {
  const [crop, setCrop] = useState({ left: 0, top: 0, width: 1, height: 1 });
  return (
    <div>
      {(['left', 'top', 'width', 'height'] as const).map((key, i) => (
        <label key={key}>
          {['左边比例', '顶部比例', '宽度比例', '高度比例'][i]}
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={crop[key]}
            onChange={(e) => setCrop({ ...crop, [key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <button type="button" onClick={() => onCrop(crop)}>
        应用裁切
      </button>
    </div>
  );
}
