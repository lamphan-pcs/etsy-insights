import { useEffect, useMemo, useState } from 'react'

const CORE_COLUMNS = [
  'listing_id',
  'title',
  'state',
  '__current_price',
  '__original_price',
  '__currency',
  'quantity',
  'views',
  'num_favorers',
  'url',
]

const LISTING_STATES = ['active', 'draft', 'inactive', 'sold', 'expired']

const MAX_ROWS_PREVIEW = [25, 50, 100, 250, 500]
const OAUTH_SESSION_KEY = 'etsy_oauth_session'
const DEFAULT_OAUTH_SCOPES = 'listings_r shops_r'

function flattenObject(value, prefix = '', output = {}) {
  if (value === null || value === undefined) {
    output[prefix] = ''
    return output
  }

  if (Array.isArray(value)) {
    const simpleArray = value.every(
      (item) => item === null || ['string', 'number', 'boolean'].includes(typeof item),
    )

    output[prefix] = simpleArray ? value.join(' | ') : JSON.stringify(value)
    return output
  }

  if (typeof value !== 'object') {
    output[prefix] = value
    return output
  }

  Object.entries(value).forEach(([key, nestedValue]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key

    if (nestedValue !== null && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      flattenObject(nestedValue, nextPrefix, output)
    } else {
      flattenObject(nestedValue, nextPrefix, output)
    }
  })

  return output
}

function normalizeMoneyValue(rawMoney) {
  if (rawMoney === null || rawMoney === undefined || rawMoney === '') {
    return ''
  }

  if (typeof rawMoney === 'number' || typeof rawMoney === 'string') {
    return String(rawMoney)
  }

  if (typeof rawMoney === 'object' && rawMoney.amount !== undefined) {
    const divisor = rawMoney.divisor || 1
    return (rawMoney.amount / divisor).toFixed(2)
  }

  return ''
}

function extractPriceFields(listing) {
  const firstOffering = listing.inventory?.products?.[0]?.offerings?.[0]

  const currentPrice =
    normalizeMoneyValue(listing.price) || normalizeMoneyValue(firstOffering?.price) || ''
  const originalPrice =
    normalizeMoneyValue(listing.original_price) ||
    normalizeMoneyValue(listing.price_before_discount) ||
    normalizeMoneyValue(firstOffering?.base_price) ||
    ''

  const currency =
    listing.price?.currency_code ||
    listing.original_price?.currency_code ||
    firstOffering?.price?.currency_code ||
    ''

  return {
    currentPrice,
    originalPrice,
    currency,
  }
}

function sortRows(rows, sortKey, sortDirection) {
  if (!sortKey) {
    return rows
  }

  const sorted = [...rows].sort((a, b) => {
    const aValue = a[sortKey] ?? ''
    const bValue = b[sortKey] ?? ''

    const aNumber = Number(aValue)
    const bNumber = Number(bValue)

    if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber) && aValue !== '' && bValue !== '') {
      return aNumber - bNumber
    }

    return String(aValue).localeCompare(String(bValue), undefined, { numeric: true })
  })

  return sortDirection === 'asc' ? sorted : sorted.reverse()
}

function rowsToTabSeparated(rows, columns) {
  const cleanCell = (value) =>
    String(value ?? '')
      .replace(/\t/g, ' ')
      .replace(/\r?\n/g, ' ')
      .trim()

  const header = columns.join('\t')
  const body = rows.map((row) => columns.map((column) => cleanCell(row[column])).join('\t'))

  return [header, ...body].join('\n')
}

function createRandomString(length) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const random = new Uint8Array(length)
  crypto.getRandomValues(random)

  return Array.from(random, (value) => alphabet[value % alphabet.length]).join('')
}

async function createCodeChallenge(codeVerifier) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  const bytes = new Uint8Array(buffer)
  const binary = bytes.reduce((accumulator, value) => accumulator + String.fromCharCode(value), '')

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function formatIsoDate(iso) {
  if (!iso) {
    return ''
  }

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleString()
}

function parseProxyError(payload, fallback) {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }

  return payload.error_description || payload.error || payload.message || fallback
}

function clearOAuthQueryParams() {
  const url = new URL(window.location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function App() {
  const callbackData = useMemo(() => {
    const params = new URLSearchParams(window.location.search)

    return {
      code: params.get('code') || '',
      state: params.get('state') || '',
      error: params.get('error') || '',
      errorDescription: params.get('error_description') || '',
    }
  }, [])

  const [shopId, setShopId] = useState(import.meta.env.VITE_ETSY_SHOP_ID || '')
  const [apiKey, setApiKey] = useState(
    import.meta.env.VITE_ETSY_API_KEY || import.meta.env.VITE_ETSY_KEYSTRING || '',
  )
  const [sharedSecret, setSharedSecret] = useState('')
  const [accessToken, setAccessToken] = useState(import.meta.env.VITE_ETSY_ACCESS_TOKEN || '')
  const [refreshToken, setRefreshToken] = useState('')
  const [tokenExpiresAt, setTokenExpiresAt] = useState('')
  const [oauthRedirectUri, setOauthRedirectUri] = useState(
    import.meta.env.VITE_ETSY_REDIRECT_URI || `${window.location.origin}${window.location.pathname}`,
  )
  const [oauthScopes, setOauthScopes] = useState(
    import.meta.env.VITE_ETSY_OAUTH_SCOPES || DEFAULT_OAUTH_SCOPES,
  )
  const [oauthMessage, setOauthMessage] = useState('')
  const [listingState, setListingState] = useState('active')
  const [pageSize, setPageSize] = useState(100)
  const [loading, setLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [allRows, setAllRows] = useState([])
  const [visibleColumns, setVisibleColumns] = useState([])
  const [searchText, setSearchText] = useState('')
  const [sortKey, setSortKey] = useState('listing_id')
  const [sortDirection, setSortDirection] = useState('asc')
  const [previewCount, setPreviewCount] = useState(100)
  const [copyMessage, setCopyMessage] = useState('')

  useEffect(() => {
    if (callbackData.error) {
      setErrorMessage(
        callbackData.errorDescription || `OAuth authorization failed: ${callbackData.error}`,
      )
      return
    }

    if (callbackData.code) {
      setOauthMessage('Authorization code detected. Click Exchange Code to create token.')
    }
  }, [callbackData])

  const allColumns = useMemo(() => {
    const unique = new Set()
    allRows.forEach((row) => {
      Object.keys(row).forEach((key) => unique.add(key))
    })

    const orderedCore = CORE_COLUMNS.filter((key) => unique.has(key))
    const extras = [...unique]
      .filter((key) => !CORE_COLUMNS.includes(key))
      .sort((a, b) => a.localeCompare(b))

    return [...orderedCore, ...extras]
  }, [allRows])

  const filteredRows = useMemo(() => {
    const query = searchText.trim().toLowerCase()
    if (!query) {
      return allRows
    }

    return allRows.filter((row) =>
      Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(query)),
    )
  }, [allRows, searchText])

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortKey, sortDirection),
    [filteredRows, sortDirection, sortKey],
  )

  const previewRows = useMemo(() => sortedRows.slice(0, previewCount), [previewCount, sortedRows])

  const selectedColumns = visibleColumns.length ? visibleColumns : allColumns

  const numericCurrentPrices = useMemo(
    () =>
      sortedRows
        .map((row) => Number(row.__current_price))
        .filter((value) => Number.isFinite(value)),
    [sortedRows],
  )

  const totalListings = sortedRows.length
  const minPrice = numericCurrentPrices.length
    ? Math.min(...numericCurrentPrices).toFixed(2)
    : 'n/a'
  const maxPrice = numericCurrentPrices.length
    ? Math.max(...numericCurrentPrices).toFixed(2)
    : 'n/a'

  const toggleColumn = (column) => {
    setVisibleColumns((previous) => {
      if (previous.includes(column)) {
        return previous.filter((item) => item !== column)
      }

      return [...previous, column]
    })
  }

  const setDefaultColumns = (columns) => {
    const preferred = CORE_COLUMNS.filter((column) => columns.includes(column))
    setVisibleColumns(preferred.length ? preferred : columns.slice(0, 12))
  }

  const handleSort = (column) => {
    if (sortKey === column) {
      setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortKey(column)
    setSortDirection('asc')
  }

  const handleFetchListings = async () => {
    if (!shopId || !apiKey || !accessToken) {
      setErrorMessage('Shop ID, API key, and access token are required.')
      return
    }

    setLoading(true)
    setErrorMessage('')
    setStatusMessage('Fetching listings from Etsy API...')
    setCopyMessage('')

    try {
      const combinedListings = []
      let offset = 0
      let hasMore = true

      while (hasMore) {
        const endpoint = new URL(
          `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/listings/${listingState}`,
        )

        endpoint.searchParams.set('limit', String(pageSize))
        endpoint.searchParams.set('offset', String(offset))

        const response = await fetch(endpoint, {
          headers: {
            'x-api-key': apiKey,
            Authorization: `Bearer ${accessToken}`,
          },
        })

        if (!response.ok) {
          throw new Error(`Etsy API request failed (${response.status} ${response.statusText}).`)
        }

        const payload = await response.json()
        const pageResults = Array.isArray(payload.results) ? payload.results : []

        combinedListings.push(...pageResults)
        offset += pageSize
        hasMore = pageResults.length === pageSize

        setStatusMessage(`Fetched ${combinedListings.length} listings...`)

        if (offset > 10000) {
          hasMore = false
        }
      }

      const mappedRows = combinedListings.map((listing) => {
        const flattened = flattenObject(listing)
        const { currentPrice, originalPrice, currency } = extractPriceFields(listing)

        return {
          ...flattened,
          __current_price: currentPrice,
          __original_price: originalPrice,
          __currency: currency,
        }
      })

      setAllRows(mappedRows)
      setDefaultColumns(
        Array.from(
          new Set(
            mappedRows.flatMap((row) => Object.keys(row)),
          ),
        ),
      )
      setStatusMessage(`Loaded ${mappedRows.length} listings.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error while calling Etsy API.')
      setStatusMessage('')
    } finally {
      setLoading(false)
    }
  }

  const handleStartOAuth = async () => {
    if (!apiKey) {
      setErrorMessage('API key (keystring) is required to start OAuth.')
      return
    }

    if (!oauthRedirectUri) {
      setErrorMessage('Redirect URI is required to start OAuth.')
      return
    }

    if (!oauthScopes.trim()) {
      setErrorMessage('At least one OAuth scope is required.')
      return
    }

    try {
      setErrorMessage('')
      setOauthMessage('Preparing Etsy OAuth login...')
      const state = createRandomString(24)
      const codeVerifier = createRandomString(64)
      const codeChallenge = await createCodeChallenge(codeVerifier)

      sessionStorage.setItem(
        OAUTH_SESSION_KEY,
        JSON.stringify({
          state,
          codeVerifier,
          redirectUri: oauthRedirectUri,
        }),
      )

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: apiKey,
        redirect_uri: oauthRedirectUri,
        scope: oauthScopes.trim(),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })

      window.location.assign(`https://www.etsy.com/oauth/connect?${params.toString()}`)
    } catch {
      setErrorMessage('Could not generate OAuth challenge. Ensure browser crypto is available.')
    }
  }

  const handleExchangeCode = async () => {
    if (!callbackData.code) {
      setErrorMessage('No OAuth code found in URL. Click Start OAuth Login first.')
      return
    }

    if (!apiKey || !sharedSecret) {
      setErrorMessage('API key and shared secret are required to exchange code.')
      return
    }

    const sessionRaw = sessionStorage.getItem(OAUTH_SESSION_KEY)
    if (!sessionRaw) {
      setErrorMessage('OAuth session is missing. Start OAuth Login again.')
      return
    }

    let session
    try {
      session = JSON.parse(sessionRaw)
    } catch {
      setErrorMessage('OAuth session is invalid. Start OAuth Login again.')
      return
    }

    if (!session.codeVerifier || !session.state) {
      setErrorMessage('OAuth verifier/state is missing. Start OAuth Login again.')
      return
    }

    if (callbackData.state && callbackData.state !== session.state) {
      setErrorMessage('OAuth state mismatch. Start OAuth Login again.')
      return
    }

    setLoading(true)
    setErrorMessage('')
    setOauthMessage('Exchanging authorization code for access token...')

    try {
      const response = await fetch('/api/etsy/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: apiKey,
          clientSecret: sharedSecret,
          code: callbackData.code,
          redirectUri: session.redirectUri || oauthRedirectUri,
          codeVerifier: session.codeVerifier,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(parseProxyError(payload, 'OAuth token exchange failed.'))
      }

      setAccessToken(payload.access_token || '')
      setRefreshToken(payload.refresh_token || '')

      if (payload.expires_in) {
        setTokenExpiresAt(new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString())
      }

      sessionStorage.removeItem(OAUTH_SESSION_KEY)
      clearOAuthQueryParams()
      setOauthMessage('OAuth completed. Access token is now filled in automatically.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'OAuth token exchange failed.')
      setOauthMessage('')
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshAccessToken = async () => {
    if (!refreshToken) {
      setErrorMessage('Refresh token is required.')
      return
    }

    if (!apiKey || !sharedSecret) {
      setErrorMessage('API key and shared secret are required to refresh token.')
      return
    }

    setLoading(true)
    setErrorMessage('')
    setOauthMessage('Refreshing access token...')

    try {
      const response = await fetch('/api/etsy/oauth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: apiKey,
          clientSecret: sharedSecret,
          refreshToken,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(parseProxyError(payload, 'OAuth refresh failed.'))
      }

      setAccessToken(payload.access_token || '')
      setRefreshToken(payload.refresh_token || refreshToken)

      if (payload.expires_in) {
        setTokenExpiresAt(new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString())
      }

      setOauthMessage('Access token refreshed successfully.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'OAuth refresh failed.')
      setOauthMessage('')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyAll = async () => {
    if (!sortedRows.length || !selectedColumns.length) {
      setCopyMessage('Nothing to copy yet.')
      return
    }

    const text = rowsToTabSeparated(sortedRows, selectedColumns)

    try {
      await navigator.clipboard.writeText(text)
      setCopyMessage(`Copied ${sortedRows.length} rows.`)
    } catch {
      setCopyMessage('Clipboard blocked. Run on localhost and allow clipboard permission.')
    }
  }

  return (
    <main className="mx-auto w-full max-w-375 px-4 py-6 md:px-8 md:py-10">
      <div className="rounded-3xl border border-(--line) bg-(--panel) p-5 shadow-xl backdrop-blur md:p-8">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mono text-xs uppercase tracking-[0.2em] text-(--muted)">Etsy API Exporter</p>
            <h1 className="mt-2 text-3xl font-bold leading-tight text-(--ink) md:text-4xl">
              Product Details + Price + Original Price
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-(--muted) md:text-base">
              Fetches all listings from the official Etsy API endpoint for your shop state, flattens all
              allowed fields, and lets you copy everything into Google Sheets or Excel.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyAll}
            className="mono rounded-xl bg-(--accent) px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105"
          >
            Copy All Rows
          </button>
        </div>

        <section className="mb-4 rounded-2xl border border-(--line) bg-white/75 p-4">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Built-in OAuth</h2>
              <p className="text-sm text-(--muted)">
                Use keystring + shared secret to sign in, then auto-fill access token for API calls.
              </p>
            </div>
            <div className="text-xs text-(--muted)">
              Callback code in URL: <strong>{callbackData.code ? 'Yes' : 'No'}</strong>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              API Key (Keystring)
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value.trim())}
                className="rounded-lg border border-(--line) px-3 py-2 outline-none ring-0 focus:border-(--accent)"
                placeholder="Your Etsy app keystring"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Shared Secret
              <input
                value={sharedSecret}
                onChange={(event) => setSharedSecret(event.target.value.trim())}
                className="rounded-lg border border-(--line) px-3 py-2 outline-none ring-0 focus:border-(--accent)"
                placeholder="Your Etsy app shared secret"
                type="password"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm lg:col-span-2">
              Redirect URI
              <input
                value={oauthRedirectUri}
                onChange={(event) => setOauthRedirectUri(event.target.value.trim())}
                className="rounded-lg border border-(--line) px-3 py-2 outline-none ring-0 focus:border-(--accent)"
                placeholder="http://localhost:5173/"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm lg:col-span-4">
              OAuth Scopes
              <input
                value={oauthScopes}
                onChange={(event) => setOauthScopes(event.target.value)}
                className="rounded-lg border border-(--line) px-3 py-2 outline-none ring-0 focus:border-(--accent)"
                placeholder="listings_r shops_r"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleStartOAuth}
              disabled={loading}
              className="rounded-xl border border-(--line) bg-[#14532d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#166534] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Start OAuth Login
            </button>
            <button
              type="button"
              onClick={handleExchangeCode}
              disabled={loading || !callbackData.code}
              className="rounded-xl border border-(--line) bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Exchange Code
            </button>
            <button
              type="button"
              onClick={handleRefreshAccessToken}
              disabled={loading || !refreshToken}
              className="rounded-xl border border-(--line) bg-[#78350f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#92400e] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Refresh Token
            </button>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Access Token
              <input
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value.trim())}
                className="rounded-lg border border-(--line) px-3 py-2 outline-none ring-0 focus:border-(--accent)"
                placeholder="OAuth bearer token"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Refresh Token
              <input
                value={refreshToken}
                onChange={(event) => setRefreshToken(event.target.value.trim())}
                className="rounded-lg border border-(--line) px-3 py-2 outline-none ring-0 focus:border-(--accent)"
                placeholder="OAuth refresh token"
              />
            </label>
          </div>

          {tokenExpiresAt ? (
            <p className="mt-2 text-xs text-(--muted)">Access token expires at: {formatIsoDate(tokenExpiresAt)}</p>
          ) : null}
        </section>

        <section className="grid gap-3 rounded-2xl border border-(--line) bg-white/70 p-4 md:grid-cols-2 lg:grid-cols-6">
          <label className="flex flex-col gap-1 text-sm lg:col-span-1">
            Shop ID
            <input
              value={shopId}
              onChange={(event) => setShopId(event.target.value.trim())}
              className="rounded-lg border border-(--line) px-3 py-2 outline-none ring-0 focus:border-(--accent)"
              placeholder="12345678"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm lg:col-span-1">
            State
            <select
              value={listingState}
              onChange={(event) => setListingState(event.target.value)}
              className="rounded-lg border border-(--line) px-3 py-2 outline-none focus:border-(--accent)"
            >
              {LISTING_STATES.map((stateValue) => (
                <option key={stateValue} value={stateValue}>
                  {stateValue}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm lg:col-span-2">
            Page Size
            <input
              type="number"
              min="1"
              max="100"
              value={pageSize}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!Number.isNaN(next)) {
                  setPageSize(Math.max(1, Math.min(100, next)))
                }
              }}
              className="rounded-lg border border-(--line) px-3 py-2 outline-none focus:border-(--accent)"
            />
          </label>

          <div className="flex flex-col justify-end lg:col-span-3">
            <button
              type="button"
              onClick={handleFetchListings}
              disabled={loading}
              className="rounded-xl border border-(--line) bg-[#102a43] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3151] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Loading...' : 'Fetch All Listings'}
            </button>
          </div>

          <label className="flex flex-col gap-1 text-sm lg:col-span-2">
            Search
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              className="rounded-lg border border-(--line) px-3 py-2 outline-none focus:border-(--accent)"
              placeholder="Filter rows by any value"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm lg:col-span-1">
            Preview Rows
            <select
              value={previewCount}
              onChange={(event) => setPreviewCount(Number(event.target.value))}
              className="rounded-lg border border-(--line) px-3 py-2 outline-none focus:border-(--accent)"
            >
              {MAX_ROWS_PREVIEW.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-(--line) bg-[#f7fafc] px-3 py-2 text-sm lg:col-span-3">
            <p>
              Total Listings: <strong>{totalListings}</strong>
            </p>
            <p>
              Current Price Range: <strong>{minPrice}</strong> to <strong>{maxPrice}</strong>
            </p>
          </div>
        </section>

        {(statusMessage || errorMessage || copyMessage || oauthMessage) && (
          <div className="mt-4 space-y-1 text-sm">
            {statusMessage ? <p className="text-[#0f5132]">{statusMessage}</p> : null}
            {oauthMessage ? <p className="text-[#334155]">{oauthMessage}</p> : null}
            {errorMessage ? <p className="text-[#842029]">{errorMessage}</p> : null}
            {copyMessage ? <p className="text-[#1e3a8a]">{copyMessage}</p> : null}
          </div>
        )}

        <section className="mt-5 rounded-2xl border border-(--line) bg-white/80 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Adjust Visible Columns</h2>
            <button
              type="button"
              onClick={() => setVisibleColumns(allColumns)}
              className="text-sm text-[#1d4ed8] underline"
            >
              Select all columns
            </button>
          </div>

          <div className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto rounded-lg border border-(--line) bg-white p-3 md:grid-cols-3 lg:grid-cols-4">
            {allColumns.map((column) => (
              <label key={column} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={selectedColumns.includes(column)}
                  onChange={() => toggleColumn(column)}
                />
                <span className="mono">{column}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border border-(--line) bg-white/90">
          <div className="max-h-[65vh] overflow-auto">
            <table className="min-w-full border-collapse text-left text-xs md:text-sm">
              <thead className="sticky top-0 z-10 bg-[#102a43] text-white">
                <tr>
                  {selectedColumns.map((column) => (
                    <th
                      key={column}
                      className="mono cursor-pointer border-b border-white/20 px-3 py-2"
                      onClick={() => handleSort(column)}
                      title="Click to sort"
                    >
                      {column}
                      {sortKey === column ? (sortDirection === 'asc' ? '  ^' : '  v') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, index) => (
                  <tr
                    key={`${row.listing_id || 'row'}-${index}`}
                    className="odd:bg-[#f8fafc] even:bg-white hover:bg-[#fff7ed]"
                  >
                    {selectedColumns.map((column) => (
                      <td key={`${column}-${index}`} className="max-w-[320px] truncate border-b border-(--line) px-3 py-2 align-top" title={String(row[column] ?? '')}>
                        {String(row[column] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
