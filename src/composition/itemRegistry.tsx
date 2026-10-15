import type { ComponentType } from 'react'
import { ImageItem } from './items/ImageItem'
import { VideoItem } from './items/VideoItem'
import { TextScene } from './items/TextScene'
import { DiagramScene } from './items/DiagramScene'
import { HtmlScene } from './items/HtmlScene'

export const ITEM_REGISTRY: Record<string, ComponentType<{ data: unknown }>> = {
  image: ImageItem,
  video: VideoItem,
  scene: TextScene,
  diagram: DiagramScene,
  html: HtmlScene
}
