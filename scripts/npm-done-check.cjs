// adr: adr/delivery-system.md
// One check of npm's approval done link, made with npm's own configuration and
// registry client, so it carries what npm's own check carries: the logged-in
// account's credential above all. The registry hands an approved one-time
// token only to that account and answers 404 to anyone else, which is how
// approved publishes read as refused (2026-10-18). Prints {"status":N} plus
// "token" on 200; exits non-zero only when npm itself cannot be loaded.
// Usage: node npm-done-check.cjs <npm install root> <done link>
const [npmRoot, doneUrl] = process.argv.slice(2)
const load = (id) => require(require.resolve(id, { paths: [npmRoot] }))

const main = async () => {
  const Config = load('@npmcli/config')
  const { definitions, flatten, nerfDarts, shorthands } = load('@npmcli/config/lib/definitions')
  const fetch = load('npm-registry-fetch')
  const config = new Config({ npmPath: npmRoot, definitions, flatten, nerfDarts, shorthands, argv: process.argv.slice(0, 2), warn: false })
  await config.load()
  let result
  try {
    const res = await fetch(doneUrl, { ...config.flat, cache: false })
    const body = await res.json().catch(() => ({}))
    result = { status: res.status, token: res.status === 200 ? body.token : undefined }
  } catch (err) {
    if (!err.statusCode) throw err
    result = { status: err.statusCode }
  }
  process.stdout.write(JSON.stringify(result))
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`)
  process.exit(1)
})
