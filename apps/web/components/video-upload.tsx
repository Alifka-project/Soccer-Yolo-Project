'use client'

import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Film } from 'lucide-react'
import { useSessionStore } from '@/lib/store'

export function VideoUpload() {
  const { uploadVideo, videoData, isUploading, videoReady } = useSessionStore()

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      await uploadVideo(acceptedFiles[0])
    }
  }, [uploadVideo])

  // No size cap: the clip is never uploaded anywhere, it is read straight from
  // disk into a blob URL, so a full-match recording is fine. The old 500MB
  // limit rejected real footage with barely a word about why.
  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.mpg', '.mpeg', '.ogv'],
    },
    maxFiles: 1,
  })

  // Say exactly why a file bounced. Only "too large" was ever reported, so a
  // file rejected for its type looked like nothing had happened at all.
  const rejection = fileRejections[0]
  const rejectionMessage = rejection
    ? rejection.errors.map((error) => {
        if (error.code === 'file-invalid-type') {
          return `${rejection.file.name} is not a video this browser will open. Try an MP4 (H.264).`
        }
        if (error.code === 'too-many-files') return 'Drop one clip at a time.'
        return error.message
      })[0]
    : ''

  return (
    <div className="space-y-2">
      <h3 className="font-medium">Video Upload</h3>
      
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive ? 'border-primary bg-primary/5' : 'border-border'}
          ${videoReady ? 'bg-green-50 border-green-300' : ''}
          ${isUploading ? 'bg-amber-50 border-amber-300' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        {isUploading ? (
          <>
            <Film className="mx-auto h-8 w-8 text-amber-600 mb-2" />
            <p className="text-sm text-amber-700">Sending to YOLO26 worker…</p>
            <p className="text-xs text-muted-foreground mt-1">
              {videoData?.name ? `${videoData.name} · ` : ''}
              {videoData ? `${(videoData.size / 1024 / 1024).toFixed(2)} MB` : ''}
            </p>
          </>
        ) : videoReady && videoData ? (
          <>
            <Film className="mx-auto h-8 w-8 text-green-600 mb-2" />
            <p className="text-sm text-green-600">Ready — press play to analyse</p>
            <p className="text-xs text-muted-foreground mt-1">
              {videoData.name ? `${videoData.name} · ` : ''}
              {(videoData.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </>
        ) : videoData ? (
          <>
            <Film className="mx-auto h-8 w-8 text-green-600 mb-2" />
            <p className="text-sm text-green-600">Ready — press play to analyse</p>
            <p className="text-xs text-muted-foreground mt-1">
              {videoData.name ? `${videoData.name} · ` : ''}
              {(videoData.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </>
        ) : (
          <>
            <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {isDragActive ? 'Drop video here' : 'Drag & drop video or click to browse'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              MP4, MOV, WebM, MKV • any size • analysed in your browser, nothing is uploaded
            </p>

          </>
        )}
      </div>

      {rejectionMessage && (
        <p className="rounded bg-red-50 p-2 text-xs text-red-700">{rejectionMessage}</p>
      )}
    </div>
  )
}
