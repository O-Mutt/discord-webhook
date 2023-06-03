import * as core from '@actions/core'
import {Embed, EmbedKey} from './embed'
import {createReadStream, readFileSync} from 'fs'
import FormData from 'form-data'
import {HttpClient} from '@actions/http-client'
import {TypedResponse} from '@actions/http-client/lib/interfaces'
import get from 'lodash.get'

const WEBHOOK_URL = 'webhook-url'
const CONTENT = 'content'
const USERNAME = 'username'
const AVATAR_URL = 'avatar-url'
const RAW_DATA = 'raw-data'
const TITLE = 'title'
const DESCRIPTION = 'description'
const TIMESTAMP = 'timestamp'
const COLOR = 'color'
const NAME = 'name'
const URL = 'url'
const ICON_URL = 'icon-url'
const TEXT = 'text'
const FILENAME = 'filename'
const THREAD_ID = 'thread-id'

const TOP_LEVEL_WEBHOOK_KEYS = [CONTENT, USERNAME, AVATAR_URL]
const EMBED_KEYS: Embed = {
  '': [TITLE, DESCRIPTION, TIMESTAMP, COLOR, URL],
  author: [NAME, URL, ICON_URL],
  footer: [TEXT, ICON_URL],
  image: [URL],
  thumbnail: [URL]
}

const DESCRIPTION_LIMIT = 4096

function createPayload(): Record<string, unknown> {
  // If raw-data provided, load the file and ignore the other parameters
  const rawData = core.getInput(RAW_DATA)
  if (rawData.length > 0) {
    return JSON.parse(readFileSync(rawData, 'utf-8'))
  }

  const webhookPayloadMap = parseTopLevelWebhookKeys()
  const embedPayloadMap = createEmbedObject()
  if (embedPayloadMap.length > 0) {
    webhookPayloadMap.set(
      'embeds',
      embedPayloadMap.map(e => Object.fromEntries(e))
    )
  }
  const webhookPayload = Object.fromEntries(webhookPayloadMap)
  core.info(JSON.stringify(webhookPayload))
  return webhookPayload
}

function parseTopLevelWebhookKeys(): Map<string, unknown> {
  // Parse action inputs into discord webhook execute payload
  const parameterMap = new Map<string, unknown>()

  for (const parameter of TOP_LEVEL_WEBHOOK_KEYS) {
    const inputKey = parameter
    let value = core.getInput(inputKey)
    if (value === '') {
      continue
    }

    if (parameter === TIMESTAMP) {
      const parsedDate = new Date(value)
      value = parsedDate.toISOString()
    }

    if (parameter === DESCRIPTION) {
      if (value.length > DESCRIPTION_LIMIT) {
        value = value.substring(0, DESCRIPTION_LIMIT)
      }
    }

    core.info(`${inputKey}: ${value}`)
    if (value.length > 0) parameterMap.set(parameter.replace('-', '_'), value)
  }

  return parameterMap
}

function createEmbedObject(): Map<string, unknown>[] {
  const value = core.getInput('embeds')
  if (value) {
    try {
      const json = JSON.parse(value) as unknown[]
      const embedPayloadMap = getEmbedValues(json)
      return embedPayloadMap
    } catch (e) {
      core.error(
        'User specified embeds but json value is malformed. Error printed below:'
      )
      core.error(JSON.stringify(e))
    }
  }
  const embedPayloadMap = getEmbedValues()
  return embedPayloadMap
}

function getEmbedValues(inputEmbeds?: unknown[]): Map<string, unknown>[] {
  // Parse action inputs into discord webhook execute payload
  const parameterMap = new Array<Map<string, unknown>>(inputEmbeds?.length ?? 1)

  let hasRootEmbed = false
  let subObjectKey: EmbedKey
  for (subObjectKey in EMBED_KEYS) {
    for (const parameter of EMBED_KEYS[subObjectKey]) {
      const discordEmbedKey = `${subObjectKey}_${parameter}`
      const inputKey = `${subObjectKey}-${parameter}`
      let value: string | undefined
      if (inputEmbeds?.length) {
        for (const [index, emb] of inputEmbeds.entries()) {
          value = get(emb, inputKey, undefined)
          value = parseValueByParameterType(parameter, value)
          if (value === '') {
            continue
          }
          parameterMap[index].set(discordEmbedKey, value)
        }
      } else {
        value = core.getInput(inputKey)
        value = parseValueByParameterType(parameter, value)
        if (value === '') {
          continue
        }
        if (value && subObjectKey && hasRootEmbed === true) {
          if (!subObjectKey) hasRootEmbed = true
          parameterMap[0].set(discordEmbedKey, value)
        }
      }
    }
  }

  return parameterMap
}

function parseValueByParameterType(
  parameter: string,
  value?: string
): string | undefined {
  if (value === undefined || value === '') return
  core.debug(`Parsing ${parameter}`)
  if (parameter === TIMESTAMP) {
    const parsedDate = new Date(value)
    value = parsedDate.toISOString()
  }

  if (parameter === DESCRIPTION) {
    if (value.length > DESCRIPTION_LIMIT) {
      value = `${value.substring(0, DESCRIPTION_LIMIT - 3)}...`
    }
  }

  if (value.length > 0) return value
}

/*

if (embedPayloadMap.size > 0) {
    const embedAuthorMap = parseMapFromParameters(
      EMBED_AUTHOR_KEYS,
      'embed-author'
    )
    if (embedAuthorMap.size > 0) {
      embedPayloadMap.set('author', Object.fromEntries(embedAuthorMap))
    }
    const embedFooterMap = parseMapFromParameters(
      EMBED_FOOTER_KEYS,
      'embed-footer'
    )
    if (embedFooterMap.size > 0) {
      embedPayloadMap.set('footer', Object.fromEntries(embedFooterMap))
    }
    const embedImageMap = parseMapFromParameters(
      EMBED_IMAGE_KEYS,
      'embed-image'
    )
    if (embedImageMap.size > 0) {
      embedPayloadMap.set('image', Object.fromEntries(embedImageMap))
    }
    const embedThumbnailMap = parseMapFromParameters(
      EMBED_THUMBNAIL_KEYS,
      'embed-thumbnail'
    )
    if (embedThumbnailMap.size > 0) {
      embedPayloadMap.set('thumbnail', Object.fromEntries(embedThumbnailMap))
    }
  }

  */
async function handleResponse(response: TypedResponse<unknown>): Promise<void> {
  core.info(
    `Webhook returned ${response.statusCode} with message: ${response.result}. Please see discord documentation at https://discord.com/developers/docs/resources/webhook#execute-webhook for more information`
  )
  if (response.statusCode >= 400) {
    core.error(
      'Discord Webhook Action failed to execute webhook. Please see logs above for details. Error printed below:'
    )
    core.error(JSON.stringify(response))
  }
}

export async function executeWebhook(): Promise<void> {
  const client = new HttpClient()
  let webhookUrl = core.getInput(WEBHOOK_URL)
  const filename = core.getInput(FILENAME)
  const threadId = core.getInput(THREAD_ID)
  const payload = createPayload()

  if (threadId !== '') {
    webhookUrl = `${webhookUrl}?thread_id=${threadId}`
  }

  if (filename !== '') {
    const formData = new FormData()
    formData.append('upload-file', createReadStream(filename))
    formData.append('payload_json', JSON.stringify(payload))
    formData.submit(webhookUrl, function (error, response) {
      if (error != null) {
        core.error(`failed to upload file: ${error.message}`)
      } else {
        core.info(
          `successfully uploaded file with status code: ${response.statusCode}`
        )
      }
    })
  } else {
    const response = await client.postJson(webhookUrl, payload)
    await handleResponse(response)
  }
}

async function run(): Promise<void> {
  try {
    core.info('Running discord webhook action...')
    await executeWebhook()
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
