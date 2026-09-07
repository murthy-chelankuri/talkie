import type { ComponentType } from 'react'
import { ImageItem } from './items/ImageItem'

export const ITEM_REGISTRY: Record<string, ComponentType<{ data: unknown }>> = {
  image: ImageItem
}
