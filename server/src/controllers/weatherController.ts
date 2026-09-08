import type { Request, Response } from 'express'

interface CachedWeather {
  cidade: string
  temperatura: number
  descricao: string
  codigo: number
  previsaoSemanal: WeatherForecastDay[]
  fetchedAt: number
}

interface WeatherForecastDay {
  data: string
  codigo: number
  temperaturaMinima: number
  temperaturaMaxima: number
}

const WEATHER_CACHE_TTL_MS = 15 * 60_000
const weatherCache = new Map<string, CachedWeather>()

// Mapeamento resumido dos "weather codes" do Open-Meteo para uma descrição
// curta em português, o suficiente para o widget do player.
const WEATHER_CODE_LABELS: Record<number, string> = {
  0: 'Céu limpo',
  1: 'Poucas nuvens',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Neblina',
  48: 'Neblina com geada',
  51: 'Garoa fraca',
  53: 'Garoa',
  55: 'Garoa forte',
  61: 'Chuva fraca',
  63: 'Chuva',
  65: 'Chuva forte',
  71: 'Neve fraca',
  73: 'Neve',
  75: 'Neve forte',
  80: 'Pancadas de chuva',
  81: 'Pancadas de chuva',
  82: 'Pancadas de chuva forte',
  95: 'Tempestade',
  96: 'Tempestade com granizo',
  99: 'Tempestade com granizo',
}

// Proxy público (sem autenticação) usado pelo widget de Clima no player.
// Usa a API gratuita Open-Meteo, que não exige chave de API: primeiro
// geocodifica a localização, depois busca a previsão atual. Aceita tanto o
// nome da cidade (?cidade=) quanto o CEP (?cep=), que é resolvido para
// cidade/UF via ViaCEP antes de geocodificar — assim o widget mostra o
// clima exato da região do CEP cadastrado, sem o operador precisar saber o
// nome "oficial" da cidade.
export async function getWeather(req: Request, res: Response) {
  const cepParam = String(req.query.cep ?? '').trim()
  const cidadeParam = String(req.query.cidade ?? '').trim()

  if (!cepParam && !cidadeParam) {
    return res.status(400).json({ message: 'Informe a cidade (?cidade=Joinville) ou o CEP (?cep=89201000)' })
  }

  const cacheKey = cepParam ? `cep:${cepParam.replace(/\D/g, '')}` : `cidade:${cidadeParam.toLowerCase()}`
  const cached = weatherCache.get(cacheKey)

  if (cached && Date.now() - cached.fetchedAt < WEATHER_CACHE_TTL_MS) {
    return res.json(toResponse(cached))
  }

  try {
    let cidade = cidadeParam

    if (cepParam) {
      const location = await resolveCep(cepParam)
      if (!location) {
        return res.status(404).json({ message: `CEP "${cepParam}" não encontrado` })
      }
      cidade = location.uf ? `${location.cidade}, ${location.uf}` : location.cidade
    }

    const coordinates = await geocodeCity(cidade)

    if (!coordinates) {
      return res.status(404).json({ message: `Local "${cidade}" não encontrado` })
    }

    const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast')
    forecastUrl.searchParams.set('latitude', String(coordinates.latitude))
    forecastUrl.searchParams.set('longitude', String(coordinates.longitude))
    forecastUrl.searchParams.set('current', 'temperature_2m,weather_code')
    forecastUrl.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min')
    forecastUrl.searchParams.set('forecast_days', '7')
    forecastUrl.searchParams.set('timezone', 'auto')

    const forecastResponse = await fetch(forecastUrl)

    if (!forecastResponse.ok) {
      throw new Error(`Previsão retornou status ${forecastResponse.status}`)
    }

    const forecastData = (await forecastResponse.json()) as {
      current?: { temperature_2m?: number; weather_code?: number }
      daily?: {
        time?: string[]
        weather_code?: number[]
        temperature_2m_max?: number[]
        temperature_2m_min?: number[]
      }
    }

    const temperatura = forecastData.current?.temperature_2m
    const codigo = forecastData.current?.weather_code

    if (typeof temperatura !== 'number' || typeof codigo !== 'number') {
      throw new Error('Resposta de previsão em formato inesperado')
    }

    const result: CachedWeather = {
      cidade: coordinates.nomeExibicao,
      temperatura,
      descricao: WEATHER_CODE_LABELS[codigo] ?? 'Condição desconhecida',
      codigo,
      previsaoSemanal: normalizeForecast(forecastData.daily),
      fetchedAt: Date.now(),
    }

    weatherCache.set(cacheKey, result)
    res.json(toResponse(result))
  } catch (error) {
    console.error('[clima] Falha ao buscar previsão', error)

    if (cached) {
      return res.json(toResponse(cached))
    }

    res.status(502).json({ message: 'Não foi possível obter a previsão do tempo' })
  }
}

async function resolveCep(cep: string): Promise<{ cidade: string; uf: string } | null> {
  const digits = cep.replace(/\D/g, '')

  if (digits.length !== 8) {
    return null
  }

  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
    signal: AbortSignal.timeout(8_000),
  })

  if (!response.ok) {
    throw new Error(`ViaCEP retornou status ${response.status}`)
  }

  const data = (await response.json()) as { erro?: boolean; localidade?: string; uf?: string }

  if (data.erro || !data.localidade) {
    return null
  }

  return { cidade: data.localidade, uf: data.uf ?? '' }
}

async function geocodeCity(
  cidade: string,
): Promise<{ latitude: number; longitude: number; nomeExibicao: string } | null> {
  const geocodeUrl = new URL('https://geocoding-api.open-meteo.com/v1/search')
  geocodeUrl.searchParams.set('name', cidade)
  geocodeUrl.searchParams.set('count', '1')
  geocodeUrl.searchParams.set('language', 'pt')

  const response = await fetch(geocodeUrl)

  if (!response.ok) {
    throw new Error(`Geocodificação retornou status ${response.status}`)
  }

  const data = (await response.json()) as {
    results?: { latitude: number; longitude: number; name: string; admin1?: string }[]
  }

  const first = data.results?.[0]

  if (!first) {
    return null
  }

  return {
    latitude: first.latitude,
    longitude: first.longitude,
    nomeExibicao: first.admin1 ? `${first.name}, ${first.admin1}` : first.name,
  }
}

function toResponse(weather: CachedWeather) {
  return {
    cidade: weather.cidade,
    temperatura: weather.temperatura,
    descricao: weather.descricao,
    codigo: weather.codigo,
    previsaoSemanal: weather.previsaoSemanal,
  }
}

function normalizeForecast(daily: {
  time?: string[]
  weather_code?: number[]
  temperature_2m_max?: number[]
  temperature_2m_min?: number[]
} | undefined): WeatherForecastDay[] {
  if (!daily?.time) return []

  return daily.time.slice(0, 7).map((data, index) => ({
    data,
    codigo: daily.weather_code?.[index] ?? 0,
    temperaturaMaxima: daily.temperature_2m_max?.[index] ?? 0,
    temperaturaMinima: daily.temperature_2m_min?.[index] ?? 0,
  }))
}
