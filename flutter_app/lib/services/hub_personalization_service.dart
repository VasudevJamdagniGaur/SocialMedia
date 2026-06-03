/// Hub vertical personalization â€” mirrors src/services/hubVerticalPersonalizationService.js
/// Best-effort analytics; failures are ignored.

Future<void> recordHubVerticalClick(String vertical) async {}

Future<void> recordHubVerticalDwell(String vertical, int seconds, int visitInc) async {}

Future<void> recordHubNewsClick(String uid, String category) async {}

Future<void> recordSportsSurfaceSeconds(int seconds) async {}

Future<void> recordSportsExploreDwell(String topicId, int seconds, int visitInc) async {}

Future<Map<String, double>> getSportsPersonalizationWeights(String? uid) async => {};

Future<void> recordAiTechExploreDwell(String topicId, int seconds, int visitInc) async {}

Future<Map<String, double>> getAiTechPersonalizationWeights() async => {};

Future<void> recordEntrepreneurshipExploreDwell(String topicId, int seconds, int visitInc) async {}

Future<Map<String, double>> getEntrepreneurshipPersonalizationWeights() async => {};

Future<void> recordCurrentAffairsExploreDwell(String topicId, int seconds, int visitInc) async {}
