/// Port of src/lib/podCurrentAffairsConstants.js

const List<String> podCurrentAffairsExploreSlugs = [
  'world-news',
  'politics',
  'economy',
  'climate',
];

const Map<String, List<String>> redditCurrentAffairsSubs = {
  'world-news': ['anime_titties', 'neutralnews', 'worldnews', 'WorldNewsHeadlines'],
  'politics': ['India', 'AskIndia', 'TeenIndians_Politics'],
  'economy': ['economy', 'Economics', 'AskEconomics', 'politicaleconomy'],
  'climate': ['climatechange', 'Permaculture', 'ClimateShitposting', 'collapse'],
};
