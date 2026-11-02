const PLATFORM = "Crunchyroll";
const PLUGIN_ID = "3af73d7b-05bc-4a1b-a142-8a8377fc9c5b";
const BASE = "https://www.crunchyroll.com";

// Must match the "options" order in CrunchyrollConfig.json settings
const LANGUAGES = [
  ["pt-BR", "Português (Brasil)"],
  ["ja-JP", "Japonês"],
  ["en-US", "Inglês"],
  ["es-419", "Espanhol (América Latina)"],
  ["es-ES", "Espanhol (Espanha)"],
  ["fr-FR", "Francês"],
  ["de-DE", "Alemão"],
  ["it-IT", "Italiano"],
  ["ru-RU", "Russo"],
  ["ar-SA", "Árabe"],
  ["hi-IN", "Hindi"],
  ["ta-IN", "Tâmil"],
  ["te-IN", "Telugu"],
  ["zh-CN", "Chinês"],
  ["ko-KR", "Coreano"],
  ["pt-PT", "Português (Portugal)"],
];

let settings = {};
let state = { access_token: null, expires_at: 0 };

function langSetting(name, fallback) {
  const idx = parseInt(settings?.[name], 10);
  return LANGUAGES[idx] ? LANGUAGES[idx][0] : fallback;
}
const getLocale = () => langSetting("locale", "pt-BR");
const getAudio = () => langSetting("audioLanguage", "ja-JP");

// Cloudflare challenge: let the user solve it in Grayjay's captcha window
function checkCaptcha(resp, url) {
  if ((resp.code === 403 || resp.code === 503) && /Just a moment|cf-chl|challenge-platform/i.test(resp.body || ""))
    throw new CaptchaRequiredException(url, resp.body);
}

function fetchAccessToken({ grant_type, useAuth = false, headers = {} }) {
  const AUTHORIZATIONS = {
    client_id: "Basic Y3Jfd2ViOg==",
    etp_rt_cookie: "Basic bm9haWhkZXZtXzZpeWcwYThsMHE6",
  };
  const resp = http.POST(
    `${BASE}/auth/v1/token`,
    `grant_type=${grant_type}`,
    Object.assign(
      {
        Authorization: AUTHORIZATIONS[grant_type],
        "Content-Type": "application/x-www-form-urlencoded",
      },
      headers
    ),
    useAuth
  );
  if (!resp.isOk) {
    checkCaptcha(resp, `${BASE}/`);
    if (resp.code === 403)
      throw new ScriptException(
        "Crunchyroll recusou o token (403). Faça login no plugin pelo Grayjay e tente novamente."
      );
    throw new ScriptException(`Token request failed (${resp.code})`);
  }
  return JSON.parse(resp.body);
}

function anonToken() {
  if (!state.access_token || Date.now() >= state.expires_at) {
    const loggedIn = bridge.isLoggedIn();
    // When logged in, use the user's session (and the cookies captured at login)
    const { access_token, expires_in } = loggedIn
      ? fetchAccessToken({
          grant_type: "etp_rt_cookie",
          headers: { "ETP-Anonymous-ID": "89142ecb-e25d-4799-b96e-b23c09a71a6b" },
          useAuth: true,
        })
      : fetchAccessToken({ grant_type: "client_id" });
    state = {
      access_token,
      expires_at: Date.now() + Math.max((expires_in || 300) - 30, 30) * 1000,
    };
  }
  return state.access_token;
}

function apiGet(url, token) {
  const useAuth = !token && bridge.isLoggedIn();
  let resp = http.GET(url, { Authorization: `Bearer ${token || anonToken()}` }, useAuth);
  if (resp.code === 401 && !token) {
    state.access_token = null;
    resp = http.GET(url, { Authorization: `Bearer ${anonToken()}` }, useAuth);
  }
  checkCaptcha(resp, url);
  if (!resp.isOk) throw new ScriptException(`Request failed (${resp.code}): ${url}`);
  return JSON.parse(resp.body);
}

function fetchObjects(token, ids) {
  if (!ids.length) return [];
  return apiGet(
    `${BASE}/content/v2/cms/objects/${ids.join(",")}?${queryString({ locale: getLocale() })}`,
    token
  ).data;
}

function queryString(o) {
  return Object.entries(o)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

function firstImage(arr, last = false) {
  const set = arr && arr[0];
  if (!set || !set.length) return null;
  return (last ? set[set.length - 1] : set[0]).source;
}

function crunchyrollEpisodeToPlatformVideoDef(episode, serie, prefix = "") {
  const meta = episode.episode_metadata || {};
  const thumbs = (episode.images?.thumbnail?.[0] || []).map(
    ({ source, height }) => new Thumbnail(source, height)
  );
  return {
    id: new PlatformID(PLATFORM, episode.id, PLUGIN_ID),
    name: prefix + episode.title,
    thumbnails: new Thumbnails(thumbs),
    author: new PlatformAuthorLink(
      new PlatformID(PLATFORM, meta.series_id, PLUGIN_ID),
      meta.series_title,
      `${BASE}/series/${meta.series_id}`,
      firstImage(serie?.images?.poster_tall),
      null
    ),
    uploadDate: Math.floor(Date.parse(meta.upload_date || meta.episode_air_date) / 1000) || 0,
    url: `${BASE}/watch/${episode.id}/${episode.slug_title || ""}`,
    duration: Math.floor((meta.duration_ms || 0) / 1000),
    viewCount: -1,
    isLive: false,
  };
}

function episodesToVideos(token, episodes) {
  const ids = [...new Set(episodes.map((e) => e.episode_metadata?.series_id).filter(Boolean))];
  const series = {};
  for (const s of fetchObjects(token, ids)) series[s.id] = s;
  return episodes.map(
    (e) => new PlatformVideo(crunchyrollEpisodeToPlatformVideoDef(e, series[e.episode_metadata.series_id]))
  );
}

class BrowsePager extends VideoPager {
  constructor(context, results, hasMore) {
    super(results, hasMore, context);
  }

  nextPage() {
    return BrowsePager.browse(this.context.next_offset);
  }

  static browse(offset = 0) {
    const audio = getAudio();
    const { data } = apiGet(
      `${BASE}/content/v2/discover/browse?${queryString({
        start: offset,
        n: 50,
        locale: getLocale(),
        preferred_audio_language: audio,
        sort_by: "newly_added",
        type: "episode",
        ratings: true,
      })}`
    );
    const onlyPreferred = settings?.onlyPreferredAudio === true || settings?.onlyPreferredAudio === "true";
    const filtered = onlyPreferred
      ? data.filter((e) => e.episode_metadata?.audio_locale === audio)
      : data;
    return new BrowsePager(
      { next_offset: offset + data.length },
      episodesToVideos(null, filtered),
      data.length > 0
    );
  }
}

// ---- Search ----
function hasLocales(list, wanted) {
  if (!wanted || !wanted.length) return true;
  const set = list || [];
  return wanted.some((w) => set.indexOf(w) !== -1);
}

function matchesLanguageFilters(item, filters) {
  const audio = filters?.audio || [];
  const subs = filters?.subtitle || [];
  const m = item.series_metadata || item.episode_metadata || {};
  const audioList = m.audio_locales || (m.audio_locale ? [m.audio_locale] : []);
  return hasLocales(audioList, audio) && hasLocales(m.subtitle_locales, subs);
}

function crunchySearch(query, type, offset, n) {
  const { data } = apiGet(
    `${BASE}/content/v2/discover/search?${queryString({
      q: query,
      n,
      start: offset,
      type,
      locale: getLocale(),
      preferred_audio_language: getAudio(),
    })}`
  );
  const bucket = (data || []).find((d) => d.type === type) || { items: [], count: 0 };
  return bucket;
}

class SearchPager extends VideoPager {
  constructor(context, results, hasMore) {
    super(results, hasMore, context);
  }
  nextPage() {
    return SearchPager.search(this.context.query, this.context.filters, this.context.offset);
  }
  static search(query, filters, offset = 0) {
    const n = 50;
    const { items, count } = crunchySearch(query, "episode", offset, n);
    const filtered = items.filter((i) => matchesLanguageFilters(i, filters));
    const next = offset + items.length;
    return new SearchPager(
      { query, filters, offset: next },
      episodesToVideos(null, filtered),
      items.length > 0 && next < (count || 0)
    );
  }
}

class SeriesSearchPager extends ChannelPager {
  constructor(context, results, hasMore) {
    super(results, hasMore, context);
  }
  nextPage() {
    return SeriesSearchPager.search(this.context.query, this.context.filters, this.context.offset);
  }
  static search(query, filters, offset = 0) {
    const n = 50;
    const { items, count } = crunchySearch(query, "series", offset, n);
    const results = items
      .filter((i) => matchesLanguageFilters(i, filters))
      .map(
        (s) =>
          new PlatformAuthorLink(
            new PlatformID(PLATFORM, s.id, PLUGIN_ID),
            s.title,
            `${BASE}/series/${s.id}/${s.slug_title || ""}`,
            firstImage(s.images?.poster_tall),
            null
          )
      );
    const next = offset + items.length;
    return new SeriesSearchPager(
      { query, filters, offset: next },
      results,
      items.length > 0 && next < (count || 0)
    );
  }
}

function languageFilterGroups() {
  const opts = (prefix) => LANGUAGES.map(([code, name]) => new FilterCapability(name, code, `${prefix}-${code}`));
  return [
    new FilterGroup("Áudio (dublagem)", opts("audio"), true, "audio"),
    new FilterGroup("Legenda", opts("subtitle"), true, "subtitle"),
  ];
}

class SeasonPager extends VideoPager {
  constructor(context, results) {
    super(results, context.season > 0, context);
  }

  nextPage() {
    return SeasonPager.season(this.context.serie, this.context.season - 1, this.context.seasons);
  }

  static season(serie, season, seasons) {
    const id = seasons[season];
    const { data } = apiGet(
      `${BASE}/content/v2/cms/seasons/${id}/episodes?${queryString({
        preferred_audio_language: getAudio(),
        locale: getLocale(),
      })}`
    );
    const results = data
      .slice()
      .reverse()
      .map(
        (episode) =>
          new PlatformVideo(
            crunchyrollEpisodeToPlatformVideoDef(
              Object.assign({}, episode, { episode_metadata: episode }),
              serie,
              `S${season + 1} E${episode.episode}: `
            )
          )
      );
    return new SeasonPager({ serie, season, seasons }, results);
  }
}

function extract_stream_id(stream_url) {
  // stream_url = /content/v2/cms/videos/:id:/streams
  if (!stream_url || !stream_url.startsWith("/content/v2/cms/videos/"))
    throw new ScriptException(`Unsupported url: ${stream_url}`);
  const [id] = stream_url.slice("/content/v2/cms/videos/".length).split("/");
  return id;
}

function parseId(url, prefix) {
  const [id] = url.slice(prefix.length).split(/[/?#]/);
  return id;
}

Object.assign(source, {
  enable(conf, userSettings, savedState) {
    settings = userSettings || {};
    if (savedState) {
      try {
        state = JSON.parse(savedState);
      } catch (e) {}
    }
    // No network call here: a failure would abort the plugin installation.
  },

  onLoggedIn() {
    state = { access_token: null, expires_at: 0 };
  },

  onLoggedOut() {
    state = { access_token: null, expires_at: 0 };
  },

  saveState() {
    return JSON.stringify(state);
  },

  getHome() {
    return BrowsePager.browse(0);
  },

  searchSuggestions(query) {
    try {
      return crunchySearch(query, "series", 0, 6).items.map((s) => s.title);
    } catch (e) {
      return [];
    }
  },

  getSearchCapabilities() {
    return new ResultCapabilities([Type.Feed.Mixed], [Type.Order.Chronological], languageFilterGroups());
  },

  search(query, type, order, filters) {
    return SearchPager.search(query, filters || {});
  },

  getSearchChannelContentsCapabilities() {
    return new ResultCapabilities([Type.Feed.Mixed], [Type.Order.Chronological], []);
  },

  searchChannels(query) {
    return SeriesSearchPager.search(query, {});
  },

  isContentDetailsUrl(url) {
    return url.startsWith(`${BASE}/watch/`) || /^https:\/\/www\.crunchyroll\.com\/[a-z-]+\/watch\//i.test(url);
  },

  getContentDetails(url) {
    if (!bridge.isLoggedIn())
      throw new ScriptLoginRequiredException("Crunchyroll videos are only available after login");
    if (!source.isContentDetailsUrl(url)) throw new ScriptException("Invalid url");

    const id = url.split("/watch/")[1].split(/[/?#]/)[0];

    const { access_token: token } = fetchAccessToken({
      grant_type: "etp_rt_cookie",
      headers: { "ETP-Anonymous-ID": "89142ecb-e25d-4799-b96e-b23c09a71a6b" },
      useAuth: true,
    });

    const [episode] = fetchObjects(token, [id]);
    const stream_id = extract_stream_id(episode.streams_link);
    const [serie] = fetchObjects(token, [episode.episode_metadata.series_id]);

    const { cms_web } = apiGet(`${BASE}/index/v2`, token);
    const qs = queryString({
      "Key-Pair-Id": cms_web.key_pair_id,
      Signature: cms_web.signature,
      Policy: cms_web.policy,
    });

    const { streams, subtitles } = apiGet(
      `${BASE}/cms/v2${cms_web.bucket}/videos/${stream_id}/streams?${qs}`,
      token
    );

    const duration = Math.floor((episode.episode_metadata.duration_ms || 0) / 1000);
    const locale = getLocale();
    const hls = Object.values(streams.adaptive_hls || {}).sort((a, b) => {
      const score = (s) => (s.hardsub_locale === locale ? 0 : !s.hardsub_locale ? 1 : 2);
      return score(a) - score(b);
    });

    return new PlatformVideoDetails(
      Object.assign(crunchyrollEpisodeToPlatformVideoDef(episode, serie), {
        description: episode.description || "",
        rating: new RatingLikes(0),
        video: new VideoSourceDescriptor(
          hls.map(
            (stream) =>
              new HLSSource({
                name: stream.hardsub_locale ? `Hardsub ${stream.hardsub_locale}` : "Original",
                duration,
                url: stream.url,
                priority: false,
              })
          )
        ),
        subtitles: Object.values(subtitles || {}).map(({ locale, url }) => ({
          name: locale,
          url,
          format: "text/vtt",
          getSubtitles() {
            const resp = http.GET(url, {});
            if (!resp.isOk) return "";
            const sections = Array.from(parseASS(resp.body));
            const events = sections.find(({ name }) => name === "Events");
            if (!events) return "WEBVTT\n";
            const subs = events.content
              .filter(({ key }) => key === "Dialogue")
              .map(({ value }) => value)
              .map(({ Start, End, Text }) => `${Start}0 --> ${End}0\n${formatASSText(Text)}\n`);
            return `WEBVTT\n\n${subs.join("\n")}`;
          },
        })),
      })
    );
  },

  getContentChapters(url) {
    if (!source.isContentDetailsUrl(url)) throw new ScriptException("Invalid url");
    const id = url.split("/watch/")[1].split(/[/?#]/)[0];
    const resp = http.GET(`https://static.crunchyroll.com/skip-events/production/${id}.json`, {});
    if (!resp.isOk) return [];
    const skip_events = JSON.parse(resp.body);
    return Object.values(skip_events)
      .filter((v) => v && typeof v === "object" && v.start != null)
      .map(({ start, end, type }) => ({
        name: type,
        timeStart: start,
        timeEnd: end,
        type: Type.Chapter.SKIPPABLE,
      }));
  },

  isChannelUrl(url) {
    return url.startsWith(`${BASE}/series/`);
  },

  getChannel(url) {
    if (!source.isChannelUrl(url)) throw new ScriptException("Invalid url");
    const id = parseId(url, `${BASE}/series/`);
    const [serie] = fetchObjects(null, [id]);
    return new PlatformChannel({
      id: new PlatformID(PLATFORM, id, PLUGIN_ID),
      name: serie.title,
      thumbnail: firstImage(serie.images?.poster_tall),
      banner: firstImage(serie.images?.poster_wide, true),
      subscribers: -1,
      description: serie.description,
      url,
    });
  },

  getChannelCapabilities() {
    return { types: [Type.Feed.Videos], sorts: [Type.Order.Chronological] };
  },

  getChannelContents(url) {
    if (!source.isChannelUrl(url)) throw new ScriptException("Invalid url");
    const id = parseId(url, `${BASE}/series/`);
    const [serie] = fetchObjects(null, [id]);
    const { data } = apiGet(
      `${BASE}/content/v2/cms/series/${id}/seasons?${queryString({
        preferred_audio_language: getAudio(),
        locale: getLocale(),
      })}`
    );
    if (!data.length) return new VideoPager([], false, {});
    return SeasonPager.season(serie, data.length - 1, data.map(({ id }) => id));
  },
});

function* parseASS(ass) {
  const sections = ass.split(/^\s*\[(.*)\]\s*$/gm);

  for (let i = 1; i < sections.length; i += 2) {
    const name = sections[i];
    const content = sections[i + 1];

    const { result } = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length !== 0)
      .reduce(
        ({ format, result }, line) => {
          if (line.startsWith("Format:")) {
            return {
              format: line
                .slice("Format:".length)
                .split(",")
                .map((s) => s.trim()),
              result,
            };
          } else {
            const key = line.slice(0, line.indexOf(":"));
            const splitted = line.slice(line.indexOf(":") + 1).split(",");
            const value = splitted
              .slice(0, format.length - 1)
              .concat(splitted.slice(format.length - 1).join(","));

            return {
              format,
              result: [
                ...result,
                {
                  key,
                  value:
                    format.length === 1
                      ? value[0]
                      : Object.fromEntries(
                          value.map((v, i) => [format[i], v.trim()])
                        ),
                },
              ],
            };
          }
        },
        {
          format: [""],
          result: [],
        }
      );

    yield { name, content: result };
  }
}

function formatASSText(text) {
  return text
    .replace(/\\N/g, "\r\n") //"\N" for new line
    .replace(/\{[^\}]+\}/g, ""); //{\blur3\pos(320,215)}
}
