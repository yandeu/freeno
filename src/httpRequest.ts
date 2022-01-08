import http from 'http'

export const httpRequest = (url: URL): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    const req = http.request(url, res => {
      res.on('data', d => {
        // nothing
      })
    })

    req.setTimeout(500, () => {
      return reject()
    })

    req.on('close', () => {
      return resolve(true)
    })

    req.on('error', error => {
      return reject()
    })

    req.end()
  })
}
