import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../utils/date_utils.dart';
import 'firestore_service.dart';
import 'vertex_api_client.dart';

/// Pattern analysis for emotional triggers, joy boosters, and distractions.
/// Mirrors src/services/patternAnalysisService.js
class PatternAnalysisService {
  PatternAnalysisService._();

  static final PatternAnalysisService instance = PatternAnalysisService._();

  final int minDaysRequired = 1;
  final int minMessagesRequired = 1;
  final int minDaysFor3Months = 1;
  final int minMessagesFor3Months = 1;

  /// Analyze patterns for triggers and boosters from chat data.
  Future<Map<String, dynamic>> analyzePatterns(String uid, {int days = 7}) async {
    debugPrint('ðŸ” Starting pattern analysis for $days days...');

    try {
      final chatData = await getChatData(uid, days);

      if (!hasEnoughData(chatData, days)) {
        debugPrint('âš ï¸ Not enough data for pattern analysis');
        return getDefaultAnalysis();
      }

      final analysisResult = await performAIAnalysis(chatData, days);

      debugPrint('âœ… Pattern analysis completed: $analysisResult');
      return analysisResult;
    } catch (error) {
      debugPrint('âŒ Error in pattern analysis: $error');
      return getDefaultAnalysis();
    }
  }

  /// Perform AI analysis on chat data via Vertex Express backend (POST /analyze-pattern).
  Future<Map<String, dynamic>> performAIAnalysis(
    List<Map<String, dynamic>> chatData,
    int days,
  ) async {
    debugPrint('ðŸ¤– Performing AI analysis on chat data...');

    if (!isVertexBackendConfigured()) {
      debugPrint('âš ï¸ Vertex backend URL not set; using default pattern analysis.');
      return getDefaultAnalysis();
    }

    try {
      final resultText = await vertexAnalyzePattern({
        'days': days,
        'chatData': chatData,
        'instruction':
            'Analyze chat logs for emotional triggers, joy sources, and distractions. Respond with ONLY valid JSON (no markdown) in this exact shape: {"triggers":{"stress":["string"],"joy":["string"],"distraction":["string"]},"insights":{"primaryStressSource":"string","mainJoySource":"string","behavioralPattern":"string"},"recommendations":["string"]}',
      });

      final parsed = parseAnalysisResult(resultText);
      debugPrint('âœ… AI analysis completed: $parsed');
      return parsed;
    } catch (error) {
      debugPrint('âŒ Error in AI analysis: $error');
      return getDefaultAnalysis();
    }
  }

  /// Get chat data from Firestore.
  Future<List<Map<String, dynamic>>> getChatData(String uid, int days) async {
    final chatData = <Map<String, dynamic>>[];

    for (var i = 0; i < days; i++) {
      final dateId = getDateIdDaysAgo(i);
      final dayData = await FirestoreService.instance.getChatMessages(uid, dateId);

      if (dayData.isNotEmpty) {
        chatData.add({
          'date': dateId,
          'messages': dayData,
        });
      }
    }

    return chatData;
  }

  /// Check if there's enough data for analysis.
  bool hasEnoughData(List<Map<String, dynamic>> chatData, int days) {
    var totalMessages = 0;
    for (final day in chatData) {
      final messages = day['messages'] as List<dynamic>? ?? [];
      totalMessages += messages.length;
    }
    final daysWithData = chatData.length;

    return daysWithData >= minDaysRequired && totalMessages >= minMessagesRequired;
  }

  /// Get default analysis when no data is available.
  Map<String, dynamic> getDefaultAnalysis() {
    return {
      'triggers': {
        'stress': ['Work pressure', 'Time constraints', 'Uncertainty'],
        'joy': ['Personal achievements', 'Social connections', 'Creative activities'],
        'distraction': ['Social media', 'Procrastination', 'Multitasking'],
      },
      'insights': {
        'primaryStressSource': 'Work-related pressure',
        'mainJoySource': 'Personal accomplishments',
        'behavioralPattern': 'Balancing work and personal life',
      },
      'recommendations': [
        'Practice time management techniques',
        'Set clear boundaries between work and personal time',
        'Engage in regular physical activity',
      ],
    };
  }

  /// Parse analysis result from AI response.
  Map<String, dynamic> parseAnalysisResult(String responseText) {
    try {
      final jsonMatch = RegExp(r'\{[\s\S]*\}').firstMatch(responseText);
      if (jsonMatch != null) {
        return jsonDecode(jsonMatch.group(0)!) as Map<String, dynamic>;
      }
    } catch (error) {
      debugPrint('âŒ Error parsing analysis result: $error');
    }

    return getDefaultAnalysis();
  }

  /// Get pattern analysis from mood data.
  Future<Map<String, dynamic>> getPatternAnalysis(
    String uid,
    int days, {
    bool forceRefresh = false,
  }) async {
    debugPrint('ðŸ” Getting pattern analysis for $days days...');

    try {
      final moodDataResult =
          await FirestoreService.instance.getMoodChartDataNew(uid, days);

      final moodData = (moodDataResult['moodData'] as List<dynamic>?)
          ?.cast<Map<String, dynamic>>();

      if (moodDataResult['success'] != true || moodData == null || moodData.isEmpty) {
        debugPrint('âš ï¸ No mood data available');
        return {
          'success': true,
          'hasEnoughData': false,
          'triggers': {
            'stress': <String>[],
            'joy': <String>[],
            'distraction': <String>[],
          },
          'patterns': <String>[],
          'analysis': 'Not enough data to identify patterns',
        };
      }

      final analysis = await analyzePatternsFromMoodData(
        moodData,
        days,
        uid,
      );

      debugPrint('âœ… Pattern analysis completed: $analysis');
      return {
        'success': true,
        'hasEnoughData': moodData.length >= 7,
        'triggers': analysis['triggers'],
        'patterns': analysis['patterns'],
        'analysis': analysis['summary'],
        'guidanceTips': analysis['guidanceTips'] ?? <Map<String, dynamic>>[],
      };
    } catch (error) {
      debugPrint('âŒ Error in getPatternAnalysis: $error');
      return {
        'success': false,
        'hasEnoughData': false,
        'triggers': {
          'stress': <String>[],
          'joy': <String>[],
          'distraction': <String>[],
        },
        'patterns': <String>[],
        'analysis': 'Error analyzing patterns',
      };
    }
  }

  /// Analyze patterns from mood data to generate triggers, joy boosters, and distractions.
  Future<Map<String, dynamic>> analyzePatternsFromMoodData(
    List<Map<String, dynamic>> moodData,
    int days, [
    String? uid,
  ]) async {
    debugPrint('ðŸ“Š Analyzing patterns from ${moodData.length} days of mood data...');

    if (moodData.isEmpty) {
      return {
        'triggers': {
          'stress': <String>[],
          'joy': <String>[],
          'distraction': <String>[],
        },
        'patterns': <String>[],
        'summary': 'No data to analyze',
      };
    }

    final validData = moodData.where((item) {
      final total = _moodNum(item, 'happiness') +
          _moodNum(item, 'energy') +
          _moodNum(item, 'anxiety') +
          _moodNum(item, 'stress');
      return total >= 10;
    }).toList();

    if (validData.isEmpty) {
      return {
        'triggers': {
          'stress': <String>[],
          'joy': <String>[],
          'distraction': <String>[],
        },
        'patterns': <String>[],
        'summary': 'Not enough meaningful data to identify patterns',
      };
    }

    var enrichedData = validData;
    if (uid != null && uid.isNotEmpty) {
      debugPrint('ðŸ“– Fetching reflections for detailed joy booster analysis...');
      try {
        enrichedData = await Future.wait(
          validData.map((day) async {
            try {
              final reflectionResult =
                  await FirestoreService.instance.getReflectionNew(uid, day['date'] as String);
              return {
                ...day,
                'summary': reflectionResult['reflection'],
              };
            } catch (error) {
              debugPrint('âš ï¸ No reflection found for ${day['date']}');
              return {...day, 'summary': null};
            }
          }),
        );
        debugPrint('âœ… Enriched mood data with reflections');
      } catch (error) {
        debugPrint('âš ï¸ Could not fetch reflections, using mood data only: $error');
      }
    }

    final stressTriggers = identifyStressTriggers(validData, enrichedData);
    final joyBoosters = identifyJoyBoosters(validData, enrichedData);
    final distractions = identifyDistractions(validData, enrichedData);
    final patterns = identifyPatterns(validData);

    final analysisResult = <String, dynamic>{
      'triggers': {
        'stress': stressTriggers,
        'joy': joyBoosters,
        'distraction': distractions,
      },
      'patterns': patterns,
      'summary': 'Analyzed ${validData.length} days of emotional data',
    };

    final guidanceTips = generatePersonalizedGuidance(analysisResult, validData);

    return {
      ...analysisResult,
      'guidanceTips': guidanceTips,
    };
  }

  /// Identify stress triggers from mood data and reflections.
  List<String> identifyStressTriggers(
    List<Map<String, dynamic>> moodData, [
    List<Map<String, dynamic>>? enrichedData,
  ]) {
    final triggers = <String>[];
    final dataWithSummaries = enrichedData ?? moodData;

    final highStressDays =
        moodData.where((d) => _moodNum(d, 'stress') >= 60).toList();
    final highAnxietyDays =
        moodData.where((d) => _moodNum(d, 'anxiety') >= 60).toList();

    final daysWithSummaries = dataWithSummaries
        .where((d) => (d['summary'] as String?)?.trim().isNotEmpty == true)
        .toList();
    final stressfulDaysWithSummary = daysWithSummaries
        .where((d) => _moodNum(d, 'stress') >= 55 || _moodNum(d, 'anxiety') >= 55)
        .toList();

    if (stressfulDaysWithSummary.isNotEmpty) {
      final processedTriggers = <String>{};

      for (final day in stressfulDaysWithSummary) {
        final summary = (day['summary'] as String? ?? '').toLowerCase();

        if ((summary.contains('work') ||
                summary.contains('deadline') ||
                summary.contains('meeting') ||
                summary.contains('project') ||
                summary.contains('boss') ||
                summary.contains('colleague')) &&
            !processedTriggers.contains('work')) {
          triggers.add('Dealing with work deadlines or meetings');
          processedTriggers.add('work');
        }

        if ((summary.contains('argument') ||
                summary.contains('conflict') ||
                summary.contains('fight') ||
                summary.contains('disagreement') ||
                summary.contains('tension')) &&
            !processedTriggers.contains('conflict')) {
          triggers.add('Having difficult conversations or arguments');
          processedTriggers.add('conflict');
        }

        if ((summary.contains('late') ||
                summary.contains('rushing') ||
                summary.contains('running out') ||
                summary.contains('time') ||
                summary.contains('busy')) &&
            !processedTriggers.contains('time')) {
          triggers.add('Rushing or running behind schedule');
          processedTriggers.add('time');
        }

        if ((summary.contains('decide') ||
                summary.contains('choice') ||
                summary.contains('unsure') ||
                summary.contains('uncertain') ||
                summary.contains('doubt')) &&
            !processedTriggers.contains('decision')) {
          triggers.add('Making difficult decisions');
          processedTriggers.add('decision');
        }

        if ((summary.contains('judge') ||
                summary.contains('criticize') ||
                summary.contains('reject') ||
                summary.contains('disapprove') ||
                summary.contains('expectation')) &&
            !processedTriggers.contains('social')) {
          triggers.add('Facing criticism or high expectations from others');
          processedTriggers.add('social');
        }

        if ((summary.contains('money') ||
                summary.contains('bill') ||
                summary.contains('financial') ||
                summary.contains('payment') ||
                summary.contains('debt')) &&
            !processedTriggers.contains('financial')) {
          triggers.add('Managing financial obligations or payments');
          processedTriggers.add('financial');
        }

        if ((summary.contains('multitask') ||
                summary.contains('overwhelm') ||
                summary.contains('too much') ||
                summary.contains('many things') ||
                summary.contains('juggling')) &&
            !processedTriggers.contains('overload')) {
          triggers.add('Juggling multiple tasks at once');
          processedTriggers.add('overload');
        }
      }
    }

    if (triggers.isEmpty) {
      if (highStressDays.length >= moodData.length * 0.3) {
        triggers.add('Working under tight deadlines');
      }

      if (highAnxietyDays.length >= moodData.length * 0.3) {
        triggers.add('Facing uncertain situations or decisions');
      }

      final stressAnxietyCombined = moodData
          .where((d) => _moodNum(d, 'stress') >= 50 && _moodNum(d, 'anxiety') >= 50)
          .toList();
      if (stressAnxietyCombined.length >= moodData.length * 0.2) {
        triggers.add('Handling multiple demanding tasks');
      }
    }

    return triggers.isNotEmpty ? triggers.take(3).toList() : <String>[];
  }

  /// Identify joy boosters from mood data and reflections.
  List<String> identifyJoyBoosters(
    List<Map<String, dynamic>> moodData, [
    List<Map<String, dynamic>>? enrichedData,
  ]) {
    final boosters = <String>[];
    final dataWithSummaries = enrichedData ?? moodData;

    final highHappinessDays =
        dataWithSummaries.where((d) => _moodNum(d, 'happiness') >= 70).toList();
    final highEnergyDays =
        dataWithSummaries.where((d) => _moodNum(d, 'energy') >= 70).toList();
    final lowStressDays =
        dataWithSummaries.where((d) => _moodNum(d, 'stress') <= 30).toList();

    final daysWithSummaries = dataWithSummaries
        .where((d) => (d['summary'] as String?)?.trim().isNotEmpty == true)
        .toList();
    final happyDaysWithSummary =
        daysWithSummaries.where((d) => _moodNum(d, 'happiness') >= 65).toList();

    if (happyDaysWithSummary.isNotEmpty) {
      final processedSummaries = <String>{};

      for (final day in happyDaysWithSummary) {
        final summary = (day['summary'] as String? ?? '').toLowerCase();

        if ((summary.contains('finished') ||
                summary.contains('completed') ||
                summary.contains('accomplished') ||
                summary.contains('achieved') ||
                summary.contains('succeeded') ||
                summary.contains('done')) &&
            !processedSummaries.contains('achievement')) {
          boosters.add('Completing tasks ahead of schedule');
          processedSummaries.add('achievement');
        }

        if ((summary.contains('friend') ||
                summary.contains('talked') ||
                summary.contains('conversation') ||
                summary.contains('joked') ||
                summary.contains('laughed') ||
                summary.contains('connected')) &&
            !processedSummaries.contains('connection')) {
          boosters.add('Talking with friends or sharing updates');
          processedSummaries.add('connection');
        }

        if ((summary.contains('calm') ||
                summary.contains('peaceful') ||
                summary.contains('quiet') ||
                summary.contains('relax') ||
                summary.contains('walk') ||
                summary.contains('breath')) &&
            !processedSummaries.contains('peace')) {
          if (summary.contains('walk')) {
            boosters.add('Going for walks');
          } else if (summary.contains('music')) {
            boosters.add('Listening to music');
          } else {
            boosters.add('Taking quiet moments to yourself');
          }
          processedSummaries.add('peace');
        }

        if ((summary.contains('learned') ||
                summary.contains('understood') ||
                summary.contains('insight') ||
                summary.contains('realized') ||
                summary.contains('growth') ||
                summary.contains('progress')) &&
            !processedSummaries.contains('growth')) {
          boosters.add('Reading or learning new things');
          processedSummaries.add('growth');
        }

        if ((summary.contains('decided') ||
                summary.contains('chose') ||
                summary.contains('set') ||
                summary.contains('boundary') ||
                summary.contains('control') ||
                summary.contains('manage')) &&
            !processedSummaries.contains('control')) {
          boosters.add('Setting boundaries or making decisions');
          processedSummaries.add('control');
        }

        if (summary.contains('music') && !processedSummaries.contains('music')) {
          boosters.add('Listening to music');
          processedSummaries.add('music');
        }

        if (summary.contains('walk') && !processedSummaries.contains('walk')) {
          boosters.add('Going for walks');
          processedSummaries.add('walk');
        }

        if (summary.contains('exercise') && !processedSummaries.contains('exercise')) {
          boosters.add('Exercising or physical activity');
          processedSummaries.add('exercise');
        }

        if (summary.contains('organize') && !processedSummaries.contains('organize')) {
          boosters.add('Organizing your space');
          processedSummaries.add('organize');
        }

        if (summary.contains('outdoor') && !processedSummaries.contains('outdoor')) {
          boosters.add('Spending time outdoors');
          processedSummaries.add('outdoor');
        }
      }
    }

    if (boosters.isEmpty) {
      if (highHappinessDays.length >= moodData.length * 0.25) {
        boosters.add('Finishing tasks and projects');
      }

      if (highEnergyDays.length >= moodData.length * 0.25) {
        boosters.add('Being productive during the day');
      }

      if (lowStressDays.length >= moodData.length * 0.3) {
        boosters.add('Taking breaks and resting');
      }
    }

    return boosters.isNotEmpty ? boosters.take(3).toList() : <String>[];
  }

  /// Identify distractions from mood data and reflections.
  List<String> identifyDistractions(
    List<Map<String, dynamic>> moodData, [
    List<Map<String, dynamic>>? enrichedData,
  ]) {
    final distractions = <String>[];
    final dataWithSummaries = enrichedData ?? moodData;

    final lowEnergyHighStress = moodData
        .where((d) => _moodNum(d, 'energy') <= 40 && _moodNum(d, 'stress') >= 50)
        .toList();
    final highStressLowHappiness = moodData
        .where((d) => _moodNum(d, 'stress') >= 60 && _moodNum(d, 'happiness') <= 50)
        .toList();
    final energyDrops = moodData.where((d) => _moodNum(d, 'energy') <= 35).toList();

    final daysWithSummaries = dataWithSummaries
        .where((d) => (d['summary'] as String?)?.trim().isNotEmpty == true)
        .toList();
    final distractedDaysWithSummary = daysWithSummaries.where((d) {
      return (_moodNum(d, 'energy') <= 40 && _moodNum(d, 'stress') >= 50) ||
          (_moodNum(d, 'stress') >= 60 && _moodNum(d, 'happiness') <= 50) ||
          _moodNum(d, 'energy') <= 35;
    }).toList();

    if (distractedDaysWithSummary.isNotEmpty) {
      final processedDistractions = <String>{};

      for (final day in distractedDaysWithSummary) {
        final summary = (day['summary'] as String? ?? '').toLowerCase();

        if ((summary.contains('scroll') ||
                summary.contains('social media') ||
                summary.contains('instagram') ||
                summary.contains('facebook') ||
                summary.contains('twitter') ||
                summary.contains('tiktok') ||
                summary.contains('phone') ||
                summary.contains('screen')) &&
            !processedDistractions.contains('scrolling')) {
          distractions.add('Scrolling through social media endlessly');
          processedDistractions.add('scrolling');
        }

        if ((summary.contains('procrastinate') ||
                summary.contains('avoid') ||
                summary.contains('delay') ||
                summary.contains('put off') ||
                summary.contains('postpone')) &&
            !processedDistractions.contains('procrastination')) {
          distractions.add('Procrastinating on important tasks');
          processedDistractions.add('procrastination');
        }

        if ((summary.contains('overthink') ||
                summary.contains('worry') ||
                summary.contains('ruminate') ||
                summary.contains('overanalyze') ||
                summary.contains('dwell')) &&
            !processedDistractions.contains('overthinking')) {
          distractions.add('Overthinking or dwelling on problems');
          processedDistractions.add('overthinking');
        }

        if ((summary.contains('binge') ||
                summary.contains('tv') ||
                summary.contains('show') ||
                summary.contains('netflix') ||
                summary.contains('streaming') ||
                summary.contains('watch')) &&
            !processedDistractions.contains('entertainment')) {
          distractions.add('Binge-watching shows or content');
          processedDistractions.add('entertainment');
        }

        if ((summary.contains('multitask') ||
                summary.contains('doing multiple') ||
                summary.contains('switching between') ||
                summary.contains('juggling')) &&
            !processedDistractions.contains('multitasking')) {
          distractions.add('Trying to do too many things at once');
          processedDistractions.add('multitasking');
        }

        if ((summary.contains('late night') ||
                summary.contains('staying up') ||
                summary.contains('sleepless') ||
                summary.contains('insomnia')) &&
            !processedDistractions.contains('late')) {
          distractions.add('Staying up late or losing sleep');
          processedDistractions.add('late');
        }

        if ((summary.contains('notification') ||
                summary.contains('interrupt') ||
                summary.contains('disturb') ||
                summary.contains('alert') ||
                summary.contains('message')) &&
            !processedDistractions.contains('interruptions')) {
          distractions.add('Constant notifications or interruptions');
          processedDistractions.add('interruptions');
        }

        if ((summary.contains('perfect') ||
                summary.contains('redo') ||
                summary.contains('redoing') ||
                summary.contains('fixing')) &&
            !processedDistractions.contains('perfectionism')) {
          distractions.add('Getting stuck on perfecting details');
          processedDistractions.add('perfectionism');
        }
      }
    }

    if (distractions.isEmpty) {
      if (lowEnergyHighStress.length >= moodData.length * 0.2) {
        distractions.add('Letting stress drain your energy throughout the day');
      }

      if (highStressLowHappiness.length >= moodData.length * 0.25) {
        distractions.add('Allowing worries to consume your attention');
      }

      if (energyDrops.length >= moodData.length * 0.3) {
        distractions.add('Staying up late or not getting enough rest');
      }
    }

    return distractions.isNotEmpty ? distractions.take(3).toList() : <String>[];
  }

  /// Identify emotional patterns from mood data.
  List<String> identifyPatterns(List<Map<String, dynamic>> moodData) {
    final patterns = <String>[];

    final avgStress =
        moodData.map((d) => _moodNum(d, 'stress')).reduce((a, b) => a + b) / moodData.length;
    final avgHappiness = moodData.map((d) => _moodNum(d, 'happiness')).reduce((a, b) => a + b) /
        moodData.length;
    final avgEnergy =
        moodData.map((d) => _moodNum(d, 'energy')).reduce((a, b) => a + b) / moodData.length;
    final avgAnxiety =
        moodData.map((d) => _moodNum(d, 'anxiety')).reduce((a, b) => a + b) / moodData.length;

    if (avgStress >= 45 && avgAnxiety >= 45) {
      patterns.add(
        'Stress and anxiety often rise together â€” when stress increases, anxiety typically follows, creating a compounding effect on your emotional state.',
      );
    }

    if (avgHappiness >= 60 && avgStress <= 40) {
      patterns.add(
        'Happiness peaks when stress is low â€” your happiest moments consistently occur when stress (40% or less) and anxiety are minimal, showing that peace and calm are essential for your joy.',
      );
    }

    if (avgEnergy <= 45 && avgStress >= 50) {
      patterns.add(
        'Low energy coincides with high stress â€” when stress rises, your energy drops, creating a cycle that can lead to burnout if not managed proactively.',
      );
    }

    final stressValues = moodData.map((d) => _moodNum(d, 'stress')).toList();
    final happinessValues = moodData.map((d) => _moodNum(d, 'happiness')).toList();
    final stressVariance = calculateVariance(stressValues);
    final happinessVariance = calculateVariance(happinessValues);

    if (stressVariance >= 300) {
      patterns.add(
        'High stress volatility â€” your stress levels fluctuate significantly from day to day, indicating unpredictable stressors or difficulty managing emotional responses to changes.',
      );
    }

    if (happinessVariance >= 300) {
      patterns.add(
        'Happiness swings â€” your mood varies considerably (variance of 300+), suggesting that external events or internal states have strong, immediate impacts on your emotional wellbeing.',
      );
    }

    return patterns;
  }

  /// Calculate variance of an array of numbers.
  double calculateVariance(List<double> values) {
    if (values.isEmpty) return 0;
    final mean = values.reduce((a, b) => a + b) / values.length;
    var variance = 0.0;
    for (final val in values) {
      variance += (val - mean) * (val - mean);
    }
    return variance / values.length;
  }

  /// Generate personalized guidance tips based on actual data patterns.
  List<Map<String, dynamic>> generatePersonalizedGuidance(
    Map<String, dynamic> analysisResult,
    List<Map<String, dynamic>> moodData,
  ) {
    final tips = <Map<String, dynamic>>[];
    final triggers = analysisResult['triggers'] as Map<String, dynamic>? ?? {};

    final avgStress =
        moodData.map((d) => _moodNum(d, 'stress')).reduce((a, b) => a + b) / moodData.length;
    final avgEnergy =
        moodData.map((d) => _moodNum(d, 'energy')).reduce((a, b) => a + b) / moodData.length;
    final avgAnxiety =
        moodData.map((d) => _moodNum(d, 'anxiety')).reduce((a, b) => a + b) / moodData.length;
    final avgHappiness = moodData.map((d) => _moodNum(d, 'happiness')).reduce((a, b) => a + b) /
        moodData.length;

    final lowEnergyDays = moodData.where((d) => _moodNum(d, 'energy') <= 40).length;
    final lowEnergyPercentage = (lowEnergyDays / moodData.length) * 100;

    final highStressDays = moodData.where((d) => _moodNum(d, 'stress') >= 60).length;
    final highStressPercentage = (highStressDays / moodData.length) * 100;

    final stressEnergyDrainDays = moodData
        .where((d) => _moodNum(d, 'energy') <= 40 && _moodNum(d, 'stress') >= 50)
        .length;
    final stressDrainPercentage = (stressEnergyDrainDays / moodData.length) * 100;

    final stressTriggers = (triggers['stress'] as List<dynamic>?)?.cast<String>() ?? [];
    if (stressTriggers.isNotEmpty) {
      final topStressTrigger = stressTriggers.first;
      if (topStressTrigger.contains('work deadlines') || topStressTrigger.contains('work')) {
        tips.add({
          'title': 'Schedule Buffer Time for Work Deadlines',
          'description':
              'You mentioned dealing with work deadlines ${highStressPercentage >= 30 ? 'on ${highStressPercentage.round()}% of your days' : 'frequently'}. Block out 30 minutes of buffer time before each deadline to prevent last-minute rushing and reduce stress.',
          'category': 'productivity',
        });
      } else if (topStressTrigger.contains('difficult conversations') ||
          topStressTrigger.contains('arguments')) {
        tips.add({
          'title': 'Prepare for Difficult Conversations',
          'description':
              'Your stress spikes during difficult conversations. Before tough talks, write down 2-3 key points you want to communicate and take 3 deep breaths to ground yourselfâ€”this helps you stay calm instead of reactive.',
          'category': 'social',
        });
      } else if (topStressTrigger.contains('decisions') ||
          topStressTrigger.contains('uncertain')) {
        tips.add({
          'title': 'Set a Decision Deadline',
          'description':
              'You feel overwhelmed when making difficult decisions. Set a time limit (e.g., "I\'ll decide by Friday at 5pm"), gather the information you need, then commitâ€”prolonging uncertainty adds unnecessary anxiety.',
          'category': 'productivity',
        });
      } else if (topStressTrigger.contains('rushing') ||
          topStressTrigger.contains('running behind')) {
        tips.add({
          'title': 'Leave 15 Minutes Earlier',
          'description':
              'You frequently feel rushed and behind schedule. Leave 15 minutes earlier than you think you needâ€”this buffer prevents time pressure stress that drops your energy below 40%.',
          'category': 'productivity',
        });
      }
    }

    final distractionTriggers =
        (triggers['distraction'] as List<dynamic>?)?.cast<String>() ?? [];
    if (distractionTriggers.isNotEmpty) {
      final topDistraction = distractionTriggers.first;
      if (topDistraction.contains('scrolling') || topDistraction.contains('social media')) {
        tips.add({
          'title': 'Use App Timers for Social Media',
          'description':
              'Your mood data shows scrolling through social media is draining your energy ${lowEnergyPercentage >= 20 ? 'on ${lowEnergyPercentage.round()}% of days' : 'frequently'}. Set a 15-minute daily limit per app using your phone\'s screen time settingsâ€”when the timer goes off, put your phone in another room.',
          'category': 'productivity',
        });
      } else if (topDistraction.contains('procrastinating')) {
        tips.add({
          'title': 'Start with 5 Minutes',
          'description':
              'You struggle with procrastination, which delays important tasks and increases stress. Commit to just 5 minutes of the taskâ€”often, starting is the hardest part, and momentum carries you forward.',
          'category': 'productivity',
        });
      } else if (topDistraction.contains('overthinking') || topDistraction.contains('dwelling')) {
        tips.add({
          'title': 'Write Down Your Worries',
          'description':
              'Overthinking is consuming your attention. When you catch yourself dwelling, write down your worry in one sentence, then set a timer for 15 minutes to problem-solveâ€”after that, move to a physical task (walk, organize) to break the mental loop.',
          'category': 'mindfulness',
        });
      } else if (topDistraction.contains('staying up late') || topDistraction.contains('sleep')) {
        tips.add({
          'title': 'Set a Phone-Free Bedtime Routine',
          'description':
              '${stressDrainPercentage >= 15 ? '${stressDrainPercentage.round()}% of your days' : 'Your data shows'} you\'re staying up late, which leads to low energy the next day. Put your phone in another room 30 minutes before bedâ€”charge it there instead of beside you.',
          'category': 'sleep',
        });
      } else if (topDistraction.contains('binge-watching') || topDistraction.contains('tv')) {
        tips.add({
          'title': 'Use Show Episodes as Breaks, Not Hours',
          'description':
              'Binge-watching is draining your energy. Watch one episode as a break, then do a 10-minute task (dishes, stretch, organize) before deciding if you want anotherâ€”this prevents autopilot scrolling and preserves your energy.',
          'category': 'self_care',
        });
      }
    }

    if (avgEnergy <= 45 || lowEnergyPercentage >= 20) {
      if (stressDrainPercentage >= 15) {
        tips.add({
          'title': 'Take Short Breaks During High-Stress Periods',
          'description':
              '${stressDrainPercentage.round()}% of your days show stress draining your energy below 40%. When you notice stress climbing, take a 5-minute break (step outside, drink water, stretch) every 90 minutesâ€”this prevents the stress-energy crash.',
          'category': 'stress_management',
        });
      } else {
        tips.add({
          'title': 'Protect Your Energy Reserves',
          'description':
              'Your energy averages ${avgEnergy.round()}%, and ${lowEnergyPercentage.round()}% of days drop below 40%. Schedule your most important tasks for when your energy is highest (usually mornings), and say no to non-essential activities that drain you.',
          'category': 'self_care',
        });
      }
    }

    final joyTriggers = (triggers['joy'] as List<dynamic>?)?.cast<String>() ?? [];
    if (joyTriggers.isNotEmpty) {
      final topJoyBooster = joyTriggers.first;
      if (topJoyBooster.contains('tasks') || topJoyBooster.contains('projects')) {
        tips.add({
          'title': 'Break Big Tasks into Small Wins',
          'description':
              'Completing tasks consistently boosts your happiness. Break larger projects into 30-minute chunksâ€”each completion gives you a small win and maintains momentum instead of waiting for the big finish.',
          'category': 'productivity',
        });
      } else if (topJoyBooster.contains('friends') || topJoyBooster.contains('talking')) {
        tips.add({
          'title': 'Schedule Weekly Connection Time',
          'description':
              'Talking with friends is one of your biggest sources of joy. Set a recurring weekly 30-minute call or coffee date with a friendâ€”consistent connection prevents social withdrawal and maintains positive energy.',
          'category': 'social',
        });
      } else if (topJoyBooster.contains('walk') || topJoyBooster.contains('outdoor')) {
        tips.add({
          'title': 'Take a 10-Minute Walk When Stress Rises',
          'description':
              'Going for walks consistently lifts your mood. When stress hits ${avgStress.round()}% or higher, step outside for a 10-minute walk immediatelyâ€”the movement and fresh air interrupt the stress cycle.',
          'category': 'self_care',
        });
      }
    }

    if (avgStress >= 50 && avgAnxiety >= 50) {
      tips.add({
        'title': 'Practice Box Breathing When Anxious',
        'description':
            'Your stress (${avgStress.round()}%) and anxiety (${avgAnxiety.round()}%) often rise together. When you notice anxiety climbing, try box breathing: inhale 4 counts, hold 4, exhale 4, hold 4â€”repeat 4 times. This physically calms your nervous system.',
        'category': 'mindfulness',
      });
    }

    if (avgHappiness <= 50 && avgStress >= 50) {
      tips.add({
        'title': 'Schedule One Joy Activity Daily',
        'description':
            'Your happiness (${avgHappiness.round()}%) is low while stress (${avgStress.round()}%) stays high. Schedule one specific activity from your joy boosters daily, even if it\'s just 10 minutesâ€”joy doesn\'t happen by accident when stress is constant.',
        'category': 'self_care',
      });
    }

    return tips.take(5).toList();
  }

  double _moodNum(Map<String, dynamic> item, String key) {
    final v = item[key];
    if (v is num) return v.toDouble();
    return 0;
  }
}

/// Singleton export (mirrors default export in patternAnalysisService.js).
final pattern_analysisService = PatternAnalysisService.instance;
