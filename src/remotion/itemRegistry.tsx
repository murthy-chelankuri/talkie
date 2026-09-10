import type { ComponentType } from 'react'
import { ImageItem } from './items/ImageItem'
import { VideoItem } from './items/VideoItem'

export const ITEM_REGISTRY: Record<string, ComponentType<{ data: unknown }>> = {
  image: ImageItem,
  video: VideoItem
}
