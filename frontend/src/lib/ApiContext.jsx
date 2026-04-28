import { createContext, useContext } from 'react'

export const ApiContext = createContext('/api/raw')

export function useApiBase() {
  return useContext(ApiContext)
}
