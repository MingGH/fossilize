const OTS_CALENDAR_URL = 'https://a.pool.opentimestamps.org/digest'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: corsHeaders,
      })
    }

    const body = await request.arrayBuffer()
    if (body.byteLength !== 32) {
      return new Response('Request body must be exactly 32 bytes', {
        status: 400,
        headers: corsHeaders,
      })
    }

    const upstream = await fetch(OTS_CALENDAR_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.opentimestamps.v1',
        'Content-Type': 'application/octet-stream',
      },
      body,
    })

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
      },
    })
  },
}
