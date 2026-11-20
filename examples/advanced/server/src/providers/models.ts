import { MicdropModel } from '@micdrop/server'
import { ModelOption } from './types'

/**
 * The models a package lists, as the select shows them: the recommended ones
 * first, in their order, then the others, and the ones the provider is
 * retiring last.
 *
 * A list that cannot be read, a key without access for instance, falls back
 * to the recommended models, so the catalog still opens.
 */
export function listedModels(
  list: () => Promise<MicdropModel[]>,
  recommended: string[]
): () => Promise<ModelOption[]> {
  return async () => {
    let models: MicdropModel[]
    try {
      models = await list()
    } catch (error) {
      console.warn('Cannot list the models, offering the usual ones:', error)
      return recommended.map((id) => ({ id, label: id }))
    }
    const rank = (model: MicdropModel) => {
      const index = recommended.findIndex(
        (id) => id === model.id || model.aliases?.includes(id)
      )
      if (index !== -1) return index
      return model.deprecated ? recommended.length + 1 : recommended.length
    }
    return models
      .map((model, order) => ({ model, order }))
      .sort((a, b) => rank(a.model) - rank(b.model) || a.order - b.order)
      .map(({ model }) => ({
        id: model.id,
        label: model.id,
        aliases: model.aliases,
        description: model.description,
        // Only a model speaking one language alone sets the call's
        language:
          model.languages?.length === 1 ? model.languages[0] : undefined,
        reasoning: model.reasoning,
        deprecated: model.deprecated,
        shutdownDate: model.shutdownDate,
      }))
  }
}

/** Whether an option is the model asked for, under its id or an alias */
export function isModel(option: ModelOption, id: string | undefined) {
  return !!id && (option.id === id || !!option.aliases?.includes(id))
}
