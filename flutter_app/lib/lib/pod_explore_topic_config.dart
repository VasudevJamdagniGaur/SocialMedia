import 'pod_topic_news_shared.dart';

/// Map explore section â†’ parent pod hub path (back button).
const Map<String, String> podExploreSectionHome = {
  'ai-tech': '/pod/ai-tech',
  'entrepreneurship': '/pod/entrepreneurship',
  'current-affairs': '/pod/current-affairs',
};

/// label: UI title; q: NewsAPI everything query; google: Google News RSS search.
const Map<String, Map<String, Map<String, String>>> exploreTopics = {
  'ai-tech': {
    'ai-models': {
      'label': 'AI Models',
      'q':
          '("large language model" OR LLM OR GPT OR Claude OR Gemini OR Llama OR "foundation model" OR Mistral OR OpenAI)',
      'google':
          '("large language model" OR GPT-4 OR Claude OR Gemini OR Llama) when:7d',
    },
    'startups': {
      'label': 'Startups',
      'q':
          '("AI startup" OR "tech startup" AND (funding OR raises OR launches) OR "seed round" OR "Series A" AI)',
      'qInternational':
          '("AI startup" OR "tech startup" AND (funding OR raises OR launches) OR "seed round" OR "Series A" AI)',
      'qLocal':
          '((India OR Indian OR Bharat OR Bengaluru OR Bangalore OR Mumbai OR Delhi OR Hyderabad OR Pune OR Chennai) AND ("AI startup" OR "tech startup" OR "machine learning startup" OR "GenAI startup")) AND (funding OR seed OR Series OR launch OR raises)',
      'google':
          '(AI startup OR machine learning startup OR tech startup funding) when:7d',
      'googleLocal':
          '(India AI startup OR Bengaluru tech startup funding OR Indian startup AI) when:7d',
      'googleInternational':
          '(AI startup OR machine learning startup OR tech startup funding) when:7d',
    },
    'tools': {
      'label': 'Tools',
      'q':
          '(MLOps OR "machine learning" API OR "Hugging Face" OR LangChain OR "vector database" OR "AI SDK")',
      'google':
          '(AI developer tools OR MLOps OR LangChain OR Hugging Face) when:7d',
    },
    'vibe-coding': {
      'label': 'Vibe Coding',
      'q':
          '(programming OR web development OR JavaScript OR TypeScript OR React OR software engineering OR "open source")',
      'google':
          '(programming OR web development OR software engineering OR open source) when:7d',
    },
    'big-tech': {
      'label': 'Big Tech',
      'q':
          '((Microsoft OR Google OR Meta OR Apple OR Amazon OR Nvidia) AND (AI OR chip OR Copilot OR Gemini OR LLM))',
      'google':
          '(Microsoft AI OR Google AI OR Meta AI OR Nvidia AI) when:7d',
    },
  },
  'entrepreneurship': {
    'startups': {
      'label': 'Startups',
      'q':
          '(startup OR unicorn OR "Series A" OR "Series B" OR accelerator OR "Y Combinator" OR venture)',
      'qInternational':
          '(startup OR unicorn OR "Series A" OR "Series B" OR accelerator OR "Y Combinator" OR venture)',
      'qLocal':
          '((India OR Indian OR Bharat OR Mumbai OR Delhi OR Bengaluru OR Bangalore OR Hyderabad OR Pune OR Chennai OR Noida OR Gurugram OR "Startup India" OR SME IPO OR BSE OR NSE OR SEBI) AND (startup OR unicorn OR funding OR "Series A" OR "Series B" OR VC OR accelerator OR IPO OR incubat OR "seed round"))',
      'google':
          '(startup funding OR Y Combinator OR venture capital startup) when:7d',
      'googleLocal':
          '("India startup" OR "Indian startup" funding OR India unicorn OR Mumbai Bengaluru startup Series A) when:7d',
      'googleInternational':
          '(startup funding OR Y Combinator OR venture capital startup) when:7d',
    },
    'founders': {
      'label': 'Founders',
      'q':
          '(founder OR "founder story" OR entrepreneur OR bootstrapping OR CEO startup)',
      'google': '(startup founder OR entrepreneur CEO interview) when:7d',
    },
  },
  'current-affairs': {
    'world-news': {
      'label': 'World News',
      'q':
          '(international news OR United Nations OR diplomacy OR "global affairs" OR world leaders)',
      'google': '(world news OR international breaking news) when:7d',
    },
    'politics': {
      'label': 'Politics',
      'q':
          '(election OR parliament OR congress OR political OR government OR campaign)',
      'google': '(political news OR election government) when:7d',
    },
    'economy': {
      'label': 'Economy',
      'q':
          '(economy OR inflation OR GDP OR "Federal Reserve" OR "interest rates" OR recession OR "jobs report")',
      'google': '(economy news inflation Federal Reserve jobs) when:7d',
    },
    'climate': {
      'label': 'Climate',
      'q':
          '("climate change" OR COP OR "renewable energy" OR emissions OR IPCC OR "extreme weather")',
      'google': '(climate change news renewable energy IPCC) when:7d',
    },
  },
};

bool isStartupsRegionTopic(String section, String topicId) {
  return topicId == 'startups' &&
      (section == 'entrepreneurship' || section == 'ai-tech');
}

String resolveExploreNewsQuery(Map<String, String>? cfg, String startupRegion) {
  if (cfg == null) return '';
  if (cfg.containsKey('qInternational') && cfg.containsKey('qLocal')) {
    return startupRegion == 'local' ? cfg['qLocal']! : cfg['qInternational']!;
  }
  return cfg['q'] ?? '';
}

String resolveExploreGoogleQuery(Map<String, String>? cfg, String startupRegion) {
  if (cfg == null) return '';
  if (cfg.containsKey('googleInternational') && cfg.containsKey('googleLocal')) {
    return startupRegion == 'local'
        ? cfg['googleLocal']!
        : cfg['googleInternational']!;
  }
  return cfg['google'] ?? '';
}

String browseGoogleQuery(String googleRssQuery) {
  return googleNewsSearchUrl(
    googleRssQuery.replaceAll(RegExp(r'\s+when:\d+d$', caseSensitive: false), '').trim(),
  );
}

List<Map<String, dynamic>> buildFallbackRows(String label, String googleQuery) {
  final baseUrl = browseGoogleQuery(googleQuery.isEmpty ? 'news' : googleQuery);
  final now = DateTime.now().toUtc().toIso8601String();
  return List.generate(6, (i) {
    return {
      'title': '$label update ${i + 1}',
      'source': 'News',
      'url': baseUrl,
      'image': null,
      'description': '$label roundup',
      'publishedAt': now,
      'sourceSiteUrl': '',
      'publisherUrl': '',
    };
  });
}

Map<String, String>? getExploreTopicConfig(String section, String topicId) {
  final cfg = exploreTopics[section]?[topicId];
  if (cfg == null) return null;
  return Map<String, String>.from(cfg);
}

String exploreSectionHomeRoute(String section) =>
    podExploreSectionHome[section] ?? '/pod';
