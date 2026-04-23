import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { X, ZoomIn, ZoomOut, Check } from 'lucide-react';

interface Props {
  imageSrc: string;
  onComplete: (croppedDataUrl: string) => void;
  onCancel: () => void;
  aspect?: number;
  outputSize?: number;
  shape?: 'round' | 'rect';
}

async function getCroppedImage(src: string, pixelCrop: Area, outputSize: number): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  return canvas.toDataURL('image/jpeg', 0.88);
}

export default function ImageCropModal({
  imageSrc,
  onComplete,
  onCancel,
  aspect = 1,
  outputSize = 512,
  shape = 'round',
}: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [applying, setApplying] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleApply = async () => {
    if (!croppedAreaPixels) return;
    setApplying(true);
    try {
      const result = await getCroppedImage(imageSrc, croppedAreaPixels, outputSize);
      onComplete(result);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/70 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-warm-100">
          <h2 className="font-display text-base font-bold text-stone-900">Crop Image</h2>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-warm-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Crop area */}
        <div className="relative w-full bg-stone-900" style={{ height: 320 }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            cropShape={shape}
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {/* Zoom slider */}
        <div className="px-5 py-4 border-t border-warm-100">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setZoom(z => Math.max(1, z - 0.1))}
              className="p-1 text-stone-400 hover:text-stone-700 transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="flex-1 accent-stone-900 h-1.5 rounded-full cursor-pointer"
            />
            <button
              onClick={() => setZoom(z => Math.min(3, z + 0.1))}
              className="p-1 text-stone-400 hover:text-stone-700 transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
          <p className="text-center text-xs text-stone-400 mt-1">Drag to reposition · Scroll or pinch to zoom</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 border border-warm-200 rounded-xl text-sm font-semibold text-stone-600 hover:bg-warm-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex-1 px-4 py-2.5 bg-stone-900 text-white rounded-xl text-sm font-semibold hover:bg-stone-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {applying ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {applying ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
