import { Micdrop, MicdropClassification } from '@micdrop/client'
import { useEffect } from 'react'

/**
 * Hook to handle Classification events
 * @param onClassification - Callback function that will be called when the classifier of the server has a result, partial or final
 */
export function useMicdropClassification<Result = any>(
  onClassification: (classification: MicdropClassification<Result>) => void
) {
  useEffect(() => {
    // Subscribe to Classification event
    Micdrop.on('Classification', onClassification)
    return () => {
      Micdrop.off('Classification', onClassification)
    }
  }, [onClassification])
}
