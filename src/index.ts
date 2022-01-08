import * as API from './api.js'
import { TinyServerHttps } from 'tiny-http2-server'
import { docker } from './docker'
import { readFileSync } from 'fs'
import cors from 'cors'
import { httpRequest } from './httpRequest.js'

const server = new TinyServerHttps()
const app = server.route
const playgroundIp = '54.93.246.90'

app.use(cors())

// ping the instance
const ping = (url: URL): Promise<void> => {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await httpRequest(url)
        if (res) {
          clearInterval(interval)
          return resolve()
        }
      } catch (error) {
        // console.log('waiting...')
      }
    }, 500)

    const timeout = setTimeout(() => {
      clearInterval(interval)
      clearTimeout(timeout)
      return reject()
    }, 15_000)
  })
}

const config = JSON.parse(readFileSync('config.json', { encoding: 'utf-8' })) as unknown as {
  image: string
  containersMax: number
  timeout: number
  containerConfig: {}
}

const IMAGE = config.image
const CONTAINERS_MAX = config.containersMax

let CONTAINERS_RUNNING = 0
API.containers().then(c => (CONTAINERS_RUNNING = c.length))

const killAndDeleteContainer = async (Id: string) => {
  await docker(`/containers/${Id}/kill`, 'POST')
  await docker(`/containers/${Id}`, 'DELETE')
  console.log('Deleted Container', Id)
}

const getContainersFormatted = async () => {
  const containers = (await API.containers()).map(c => {
    return {
      Id: c.Id,
      // Image: c.Image,
      Create: c.Created,
      CreatedISO: new Date(c.Created * 1000).toISOString(),
      Age: Math.round(new Date().getTime() / 1000 - c.Created)
      // Port: c.Ports[0]?.PublicPort
    }
  })
  CONTAINERS_RUNNING = containers.length
  return containers
}

// kill container after timeout
setInterval(async () => {
  const containers = await getContainersFormatted()

  for (const c of containers) {
    if (c.Age >= config.timeout) {
      await killAndDeleteContainer(c.Id)
    }
  }
}, 15_000)

app.get('/', _ => getContainersFormatted())

app.get('/kill-all', async () => {
  const cs = await API.containers()

  for (const c of cs) {
    await killAndDeleteContainer(c.Id)
  }

  return 'done'
})

app.get('/ping/:port', async ctx => {
  const { port } = ctx.req.params

  try {
    await ping(new URL('http://' + playgroundIp + ':' + port))
    ctx.res.status(200).send.text('ok')
  } catch (error) {
    ctx.res.status(500).send.text('failed')
  }
})

app.get('/run', async ctx => {
  if (CONTAINERS_RUNNING >= CONTAINERS_MAX) return ctx.res.status(429).send.json({ msg: 'max containers reached' })

  const name = Math.random().toString(36).slice(2)

  // pull images
  const pull = await docker(`/images/create?fromImage=${IMAGE}`, 'POST')

  // create
  const create = (await docker(`/containers/create?${name}`, 'POST', {
    Image: IMAGE,
    ...config.containerConfig
  })) as any

  // TODO(yandeu):
  // if res is { "message": "No such image: ubuntu:latest" },
  // pull the image and try to create it again

  // run
  if (!create || !create.Id) return create

  const start = await docker(`/containers/${create.Id}/start?itd`, 'POST')

  const json = (await docker(`/containers/${create.Id}/json`)) as any
  const hostPort = json?.NetworkSettings?.Ports?.['3000/tcp']?.[0].HostPort

  return { hostPort }
})

server.listen(3080).then(port => {
  console.log(`https://127.0.0.1:${port}`)
})
