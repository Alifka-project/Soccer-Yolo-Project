'use client'

import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Film } from 'lucide-react'
import { useSessionStore } from '@/lib/store'

export function VideoUpload() {
  const { uploadVideo, videoData } = useSessionStore()

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      await uploadVideo(acceptedFiles[0])
    }
  }, [uploadVideo])

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: { 'video/*': ['.mp4', '.avi', '.mov'] },
    maxFiles: 1,
    maxSize: 40 * 1024 * 1024 // 40MB limit for Vercel
  })

  return (
    <div className="space-y-2">
      <h3 className="font-medium">Video Upload</h3>
      
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive ? 'border-primary bg-primary/5' : 'border-border'}
          ${videoData ? 'bg-green-50 border-green-300' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        {videoData ? (
          <>
            <Film className="mx-auto h-8 w-8 text-green-600 mb-2" />
            <p className="text-sm text-green-600">Video uploaded successfully</p>
            <p className="text-xs text-muted-foreground mt-1">
              Size: {(videoData.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </>
        ) : (
          <>
            <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {isDragActive ? 'Drop video here' : 'Drag & drop video or click to browse'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              MP4, AVI, MOV • Max 40MB • 1080p
            </p>
            {fileRejections.length > 0 && (
              <p className="text-xs text-red-500 mt-1">
                File too large. Maximum size is 40MB.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
