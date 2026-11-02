const PLATFORM = "Crunchyroll";
const PLUGIN_ID = "3af73d7b-05bc-4a1b-a142-8a8377fc9c5b";

// Must match the "options" order in CrunchyrollConfig.json settings
const LANGUAGES = [
  ["pt-BR", "Português (Brasil)"], ["ja-JP", "Japonês"], ["en-US", "Inglês"],
  ["es-419", "Espanhol (América Latina)"], ["es-ES", "Espanhol (Espanha)"],
  ["fr-FR", "Francês"], ["de-DE", "Alemão"], ["it-IT", "Italiano"],
  ["ru-RU", "Russo"], ["ar-SA", "Árabe"], ["hi-IN", "Hindi"], ["ta-IN", "Tâmil"],
  ["te-IN", "Telugu"], ["zh-CN", "Chinês"], ["ko-KR", "Coreano"],
  ["pt-PT", "Português (Portugal)"],
];

let settings = {};
function langSetting(name, fallback) {
  const idx = parseInt(settings && settings[name], 10);
  return LANGUAGES[idx] ? LANGUAGES[idx][0] : fallback;
}
const getLocale = () => langSetting("locale", "pt-BR");
const getAudio = () => langSetting("audioLanguage", "ja-JP");

function firstImage(arr) {
  const set = arr && arr[0];
  return set && set.length ? set[0].source : null;
}

function fetchAccessToken({ grant_type, useAuth = false, headers = {} }) {
  const AUTHORIZATIONS = {
    client_id: "Basic Y3Jfd2ViOg==",
    etp_rt_cookie: "Basic bm9haWhkZXZtXzZpeWcwYThsMHE6",
  };
  const resp = http.POST(
    "https://www.crunchyroll.com/auth/v1/token",
    `grant_type=${grant_type}`,
    {
      Authorization: AUTHORIZATIONS[grant_type],
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    useAuth
  );

  if (!resp.isOk)
    throw new ScriptException(
      `Crunchyroll recusou o token (${resp.code}). Faça login no plugin e tente novamente.`
    );
  const { access_token } = JSON.parse(resp.body);

  return access_token;
}

let cachedToken = null;
let cachedTokenLoggedIn = null;
function getToken() {
  const loggedIn = bridge.isLoggedIn();
  if (!cachedToken || cachedTokenLoggedIn !== loggedIn) {
    cachedToken = loggedIn
      ? fetchAccessToken({
          grant_type: "etp_rt_cookie",
          headers: { "ETP-Anonymous-ID": "89142ecb-e25d-4799-b96e-b23c09a71a6b" },
          useAuth: true,
        })
      : fetchAccessToken({ grant_type: "client_id" });
    cachedTokenLoggedIn = loggedIn;
  }
  return cachedToken;
}

function fetchObjects(access_token, ids) {
  const resp = http.GET(
    `https://www.crunchyroll.com/content/v2/cms/objects/${ids.join(",")}`,
    {
      Authorization: `Bearer ${access_token}`,
    }
  );

  return JSON.parse(resp.body).data;
}

function queryString(o) {
  return Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function crunchyrollEpisodeToPlatformVideoDef(episode, serie, prefix = "") {
  return {
    id: new PlatformID(PLATFORM, episode.id, PLUGIN_ID),
    name: prefix + episode.title,
    thumbnails: new Thumbnails(
      ((episode.images && episode.images.thumbnail && episode.images.thumbnail[0]) || []).map(
        ({ source, height }) => new Thumbnail(source, height)
      )
    ),
    author: new PlatformAuthorLink(
      new PlatformID(PLATFORM, episode.episode_metadata.series_id, PLUGIN_ID),
      episode.episode_metadata.series_title,
      `https://www.crunchyroll.com/series/${episode.episode_metadata.series_id}`,
      firstImage(serie && serie.images && serie.images.poster_tall),
      null
    ),
    uploadDate: Date.parse(episode.episode_metadata.upload_date) / 1000,
    url: `https://www.crunchyroll.com/watch/${episode.id}/${episode.slug_title}`,

    duration: episode.episode_metadata.duration_ms / 1000,
    viewCount: -1,
    isLive: false,
  };
}

class BrowsePager extends VideoPager {
  constructor(context, results) {
    super(results, results.length >= 0, context);
  }

  nextPage() {
    return BrowsePager.browse(
      this.context.access_token,
      this.context.next_offset
    );
  }

  static browse(access_token, offset = 0) {
    const qs = queryString({
      start: offset,
      n: 100,
      locale: getLocale(),
      preferred_audio_language: getAudio(),
      sort_by: "newly_added",
      type: "episode",
      ratings: true,
    });

    const url = `https://www.crunchyroll.com/content/v2/discover/browse?${qs}`;
    const resp = http.GET(url, {
      Authorization: `Bearer ${access_token}`,
    });

    const { data } = JSON.parse(resp.body);

    const filtered = data.filter(
      (episode) => !episode.episode_metadata.is_dubbed
    );

    const series_ids = [
      ...new Set(filtered.map((episode) => episode.episode_metadata.series_id)),
    ];

    const series = Object.fromEntries(
      fetchObjects(access_token, series_ids).map((serie) => [serie.id, serie])
    );

    const results = data
      .filter((episode) => !episode.episode_metadata.is_dubbed)
      .map(
        (episode) =>
          new PlatformVideo(
            crunchyrollEpisodeToPlatformVideoDef(
              episode,
              series[episode.episode_metadata.series_id]
            )
          )
      );

    return new BrowsePager(
      { access_token, next_offset: offset + data.length },
      results
    );
  }
}

class SeasonPager extends VideoPager {
  constructor(context, results) {
    const isLastSeason = context.season === 0;
    super(results, !isLastSeason, context);
  }

  nextPage() {
    return SeasonPager.season(
      this.context.access_token,
      this.context.serie,
      this.context.season - 1,
      this.context.seasons
    );
  }

  static season(access_token, serie, season, seasons) {
    const id = seasons[season];

    const resp = http.GET(
      `https://www.crunchyroll.com/content/v2/cms/seasons/${id}/episodes?preferred_audio_language=${getAudio()}&locale=${getLocale()}`,
      {
        Authorization: `Bearer ${access_token}`,
      }
    );

    const { data } = JSON.parse(resp.body);

    console.log(data);

    const results = data
      .slice()
      .reverse()
      .map(
        (episode) =>
          new PlatformVideo(
            crunchyrollEpisodeToPlatformVideoDef(
              { ...episode, episode_metadata: episode },
              serie,
              `S${season + 1} E${episode.episode}: `
            )
          )
      );

    return new SeasonPager({ access_token, serie, season, seasons }, results);
  }
}

function crunchySearch(access_token, query, type, offset, n) {
  const qs = queryString({
    q: encodeURIComponent(query),
    n,
    start: offset,
    type,
    locale: getLocale(),
    preferred_audio_language: getAudio(),
  });
  const resp = http.GET(`https://www.crunchyroll.com/content/v2/discover/search?${qs}`, {
    Authorization: `Bearer ${access_token}`,
  });
  const { data } = JSON.parse(resp.body);
  return (data || []).find((d) => d.type === type) || { items: [], count: 0 };
}

function matchesLanguageFilters(item, filters) {
  const has = (list, wanted) =>
    !wanted || !wanted.length || wanted.some((w) => (list || []).indexOf(w) !== -1);
  const m = item.series_metadata || item.episode_metadata || {};
  const audio = m.audio_locales || (m.audio_locale ? [m.audio_locale] : []);
  return has(audio, filters.audio) && has(m.subtitle_locales, filters.subtitle);
}

class SearchPager extends VideoPager {
  constructor(context, results, hasMore) {
    super(results, hasMore, context);
  }
  nextPage() {
    const c = this.context;
    return SearchPager.search(c.access_token, c.query, c.filters, c.offset);
  }
  static search(access_token, query, filters, offset) {
    const { items, count } = crunchySearch(access_token, query, "episode", offset, 50);
    const filtered = items.filter((i) => matchesLanguageFilters(i, filters));
    const ids = [...new Set(filtered.map((e) => e.episode_metadata.series_id))];
    const series = ids.length
      ? Object.fromEntries(fetchObjects(access_token, ids).map((s) => [s.id, s]))
      : {};
    const results = filtered.map(
      (e) => new PlatformVideo(crunchyrollEpisodeToPlatformVideoDef(e, series[e.episode_metadata.series_id]))
    );
    const next = offset + items.length;
    return new SearchPager({ access_token, query, filters, offset: next }, results, items.length > 0 && next < (count || 0));
  }
}

class SeriesSearchPager extends ChannelPager {
  constructor(context, results, hasMore) {
    super(results, hasMore, context);
  }
  nextPage() {
    return SeriesSearchPager.search(this.context.access_token, this.context.query, this.context.offset);
  }
  static search(access_token, query, offset) {
    const { items, count } = crunchySearch(access_token, query, "series", offset, 50);
    const results = items.map(
      (s) =>
        new PlatformAuthorLink(
          new PlatformID(PLATFORM, s.id, PLUGIN_ID),
          s.title,
          `https://www.crunchyroll.com/series/${s.id}`,
          firstImage(s.images && s.images.poster_tall),
          null
        )
    );
    const next = offset + items.length;
    return new SeriesSearchPager({ access_token, query, offset: next }, results, items.length > 0 && next < (count || 0));
  }
}

function extract_stream_id(stream_url) {
  // stream_url = /content/v2/cms/videos/:id:/streams

  if (!stream_url.startsWith("/content/v2/cms/videos/"))
    throw new Error(`Unsupported url: ${stream_url}`);

  const [id] = stream_url.slice("/content/v2/cms/videos/".length).split("/");

  return id;
}

Object.assign(source, {
  enable(conf, userSettings) {
    settings = userSettings || {};
    // Token is fetched lazily: an error here would leave the plugin disabled
    // (and the login button would not open the Crunchyroll page).
  },

  searchSuggestions(query) {
    try {
      return crunchySearch(getToken(), query, "series", 0, 6).items.map((s) => s.title);
    } catch (e) {
      return [];
    }
  },

  getSearchCapabilities() {
    const opts = (p) => LANGUAGES.map(([code, name]) => new FilterCapability(name, code, `${p}-${code}`));
    return new ResultCapabilities(
      [Type.Feed.Mixed],
      [Type.Order.Chronological],
      [
        new FilterGroup("Áudio (dublagem)", opts("audio"), true, "audio"),
        new FilterGroup("Legenda", opts("subtitle"), true, "subtitle"),
      ]
    );
  },

  search(query, type, order, filters) {
    return SearchPager.search(getToken(), query, filters || {}, 0);
  },

  searchChannels(query) {
    return SeriesSearchPager.search(getToken(), query, 0);
  },

  getHome() {
    return BrowsePager.browse(getToken());
  },

  isContentDetailsUrl(url) {
    return url.startsWith("https://www.crunchyroll.com/watch/");
  },

  getContentDetails(url) {
    if (!bridge.isLoggedIn())
      throw new ScriptLoginRequiredException(
        "Crunchyroll videos are only available after login"
      );

    if (!source.isContentDetailsUrl(url)) throw new Error("Invalid url");

    const suburl = url.slice("https://www.crunchyroll.com/watch/".length);

    const [id, slug] = suburl.split("/");

    const authenticated_access_token = fetchAccessToken({
      grant_type: "etp_rt_cookie",
      headers: {
        "ETP-Anonymous-ID": "89142ecb-e25d-4799-b96e-b23c09a71a6b",
      },
      useAuth: true,
    });

    const [episode] = fetchObjects(authenticated_access_token, [id]);

    const stream_id = extract_stream_id(episode.streams_link);

    const [serie] = fetchObjects(authenticated_access_token, [
      episode.episode_metadata.series_id,
    ]);

    const resp_index = http.GET("https://www.crunchyroll.com/index/v2", {
      Authorization: `Bearer ${authenticated_access_token}`,
    });

    const { cms_web } = JSON.parse(resp_index.body);

    const qs = queryString({
      "Key-Pair-Id": cms_web.key_pair_id,
      Signature: cms_web.signature,
      Policy: cms_web.policy,
    });

    const resp_streams = http.GET(
      `https://www.crunchyroll.com/cms/v2${cms_web.bucket}/videos/${stream_id}/streams?${qs}`,
      {
        Authorization: `Bearer ${authenticated_access_token}`,
      }
    );

    const { streams, subtitles } = JSON.parse(resp_streams.body);

    console.log(streams);

    return new PlatformVideoDetails({
      ...crunchyrollEpisodeToPlatformVideoDef(episode, serie),
      description: episode.description,
      video: new VideoSourceDescriptor(
        Object.values(streams.adaptive_hls).map(
          (stream) =>
            new HLSSource({
              name: stream.hardsub_locale || "vo",
              duration: episode.duration_ms / 1000,
              url: stream.url,
            })
        )
      ),
      subtitles: Object.values(subtitles).map(({ locale, url }) => ({
        name: locale,
        url,
        format: "text/vtt",
        getSubtitles() {
          const resp = http.GET(url, {});
          if (!resp.isOk) return "";
          const ass = resp.body;

          const sections = Array.from(parseASS(ass));

          const subs = sections
            .find(({ name }) => name === "Events")
            .content.filter(({ key }) => key === "Dialogue")
            .map(({ value }) => value)
            .map(
              ({ Start, End, Text }) =>
                `${Start}0 --> ${End}0\n${formatASSText(Text)}\n`
            );

          return `WEBVTT\n\n${subs.join("\n")}`;
        },
      })),
    });
  },

  getContentChapters(url) {
    if (!source.isContentDetailsUrl(url)) throw new Error("Invalid url");

    const suburl = url.slice("https://www.crunchyroll.com/watch/".length);

    const [id, slug] = suburl.split("/");

    const resp = http.GET(
      `https://static.crunchyroll.com/skip-events/production/${id}.json`,
      {}
    );

    const skip_events = JSON.parse(resp.body);

    return Object.values(skip_events)
      .filter((v) => typeof v === "object")
      .map(({ start, end, type }) => ({
        name: type,
        timeStart: start,
        timeEnd: end,
        type: Type.Chapter.SKIPPABLE,
      }));
  },

  isChannelUrl(url) {
    return url.startsWith("https://www.crunchyroll.com/series/");
  },

  getChannel(url) {
    if (!source.isChannelUrl(url)) throw new Error("Invalid url");

    const suburl = url.slice("https://www.crunchyroll.com/series/".length);

    const [id, slug] = suburl.split("/");

    const [serie] = fetchObjects(getToken(), [id]);

    console.log(serie);

    return new PlatformChannel({
      id: new PlatformID(PLATFORM, id, PLUGIN_ID),
      name: serie.title,
      thumbnail: serie.images.poster_tall[0][0].source,
      banner: serie.images.poster_wide[0].slice(-1)[0].source,
      subscribers: -1,
      description: serie.description,
      url,
    });
  },

  getChannelCapabilities() {
    return {
      types: [Type.Feed.Videos],
      sorts: [Type.Order.Chronological],
    };
  },

  getChannelContents(url) {
    if (!source.isChannelUrl(url)) throw new Error("Invalid url");

    const suburl = url.slice("https://www.crunchyroll.com/series/".length);

    const [id, slug] = suburl.split("/");

    const [serie] = fetchObjects(getToken(), [id]);

    const resp = http.GET(
      `https://www.crunchyroll.com/content/v2/cms/series/${id}/seasons?preferred_audio_language=${getAudio()}&locale=${getLocale()}`,
      {
        Authorization: `Bearer ${getToken()}`,
      }
    );

    const { data } = JSON.parse(resp.body);

    return SeasonPager.season(
      getToken(),
      serie,
      data.length - 1,
      data.map(({ id }) => id)
    );
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
