import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  Image,
  type NativeSyntheticEvent,
} from 'react-native';
import PagerView, {
  type PagerViewOnPageScrollEventData,
} from 'react-native-pager-view';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

export type TeaNewsItem = {
  id: string;
  title: string;
  description: string;
  category: string;
  image: string;
  source: string;
  time: string;
};

export const newsFeed: TeaNewsItem[] = [
  {
    id: '1',
    title: "Seems like Sid made this for Kiara on mother's day!",
    description: 'Fans react to the viral post online.',
    category: 'Entertainment',
    image: 'https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?w=1080&q=80',
    source: 'Tea',
    time: '2m ago',
  },
  {
    id: '2',
    title: 'Award season buzz: unexpected nominations shake up the charts.',
    description: 'Industry insiders weigh in on the surprises and snubs this year.',
    category: 'Film',
    image: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=1080&q=80',
    source: 'Tea',
    time: '15m ago',
  },
  {
    id: '3',
    title: 'Street style from last night’s premiere turned every head.',
    description: 'The standout looks that broke the internet overnight.',
    category: 'Fashion',
    image: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1080&q=80',
    source: 'Tea',
    time: '32m ago',
  },
  {
    id: '4',
    title: 'Studio drops teaser for the franchise reboot fans demanded.',
    description: 'First reactions promise a darker tone and fresh cast chemistry.',
    category: 'Trailers',
    image: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1080&q=80',
    source: 'Tea',
    time: '1h ago',
  },
  {
    id: '5',
    title: 'Playlist takeover: the album climbing every chart this week.',
    description: 'Streaming numbers broke records in under twenty-four hours.',
    category: 'Music',
    image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1080&q=80',
    source: 'Tea',
    time: '3h ago',
  },
];

const palette = {
  bg: '#000000',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.62)',
  accent: '#A855F7',
  pillBg: 'rgba(168,85,247,0.22)',
  headerTint: 'rgba(10,8,14,0.72)',
};

export type TeaFeedScreenProps = {
  onClose?: () => void;
};

type TabKey = 'forYou' | 'trending';

function TeaStoryPage({
  item,
  index,
  fractionalPage,
  height,
  width,
}: {
  item: TeaNewsItem;
  index: number;
  fractionalPage: SharedValue<number>;
  height: number;
  width: number;
}) {
  const imageAnimatedStyle = useAnimatedStyle(() => {
    const d = fractionalPage.value - index;
    const translateY = interpolate(d, [-1, 0, 1], [28, 0, -28], Extrapolation.CLAMP);
    const scale = interpolate(Math.abs(d), [0, 1], [1.03, 1], Extrapolation.CLAMP);
    return {
      transform: [{ translateY }, { scale }],
    };
  });

  const cardAnimatedStyle = useAnimatedStyle(() => {
    const d = Math.abs(fractionalPage.value - index);
    const scale = interpolate(d, [0, 0.45, 1], [1, 0.985, 0.96], Extrapolation.CLAMP);
    return { transform: [{ scale }] };
  });

  const textAnimatedStyle = useAnimatedStyle(() => {
    const d = Math.abs(fractionalPage.value - index);
    const opacity = interpolate(d, [0, 0.35, 0.85], [1, 0.55, 0.2], Extrapolation.CLAMP);
    const translateY = interpolate(d, [0, 1], [0, 14], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  return (
    <View style={[styles.page, { height, width }]}>
      <Animated.View style={[styles.cardShell, cardAnimatedStyle]}>
        <Animated.View style={[styles.imageWrap, imageAnimatedStyle]}>
          <Image
            source={{ uri: item.image }}
            style={[styles.heroImage, { width, height }]}
            resizeMode="contain"
          />
        </Animated.View>

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.94)']}
          locations={[0.2, 0.55, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <Animated.View style={[styles.bottomBlock, { paddingBottom: 28 }, textAnimatedStyle]}>
          <View style={styles.categoryPill}>
            <Text style={styles.categoryText}>{item.category}</Text>
          </View>
          <Text style={styles.headline}>{item.title}</Text>
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaSource}>{item.source}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaTime}>{item.time}</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.actionsColumn, textAnimatedStyle]}>
          <Pressable style={styles.actionHit} accessibilityRole="button" accessibilityLabel="Like">
            <Ionicons name="heart-outline" size={28} color={palette.text} />
          </Pressable>
          <Pressable style={styles.actionHit} accessibilityRole="button" accessibilityLabel="Bookmark">
            <Ionicons name="bookmark-outline" size={26} color={palette.text} />
          </Pressable>
          <Pressable style={styles.actionHit} accessibilityRole="button" accessibilityLabel="Share">
            <Ionicons name="share-social-outline" size={26} color={palette.text} />
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export function TeaFeedScreen({ onClose }: TeaFeedScreenProps) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('forYou');
  const fractionalPage = useSharedValue(0);

  const feed = useMemo(() => {
    if (tab === 'forYou') return newsFeed;
    return [...newsFeed].sort((a, b) => Number(b.id) - Number(a.id));
  }, [tab]);

  const onPageScroll = useCallback(
    (e: NativeSyntheticEvent<PagerViewOnPageScrollEventData>) => {
      const { position, offset } = e.nativeEvent;
      fractionalPage.value = position + offset;
    },
    [fractionalPage]
  );

  const onPageSelected = useCallback(
    (e: NativeSyntheticEvent<{ position: number }>) => {
      fractionalPage.value = e.nativeEvent.position;
    },
    [fractionalPage]
  );

  const switchTab = useCallback(
    (next: TabKey) => {
      setTab(next);
      fractionalPage.value = 0;
    },
    [fractionalPage]
  );

  const headerPadTop = insets.top + 6;

  return (
    <View style={[styles.root, { height }]}>
      <StatusBar style="light" />
      <PagerView
        key={tab}
        style={styles.pager}
        initialPage={0}
        orientation="vertical"
        onPageScroll={onPageScroll}
        onPageSelected={onPageSelected}
        scrollEnabled
        overdrag={false}
      >
        {feed.map((item, index) => (
          <View key={item.id} collapsable={false} style={{ flex: 1 }}>
            <TeaStoryPage
              item={item}
              index={index}
              fractionalPage={fractionalPage}
              height={height}
              width={width}
            />
          </View>
        ))}
      </PagerView>

      <View style={[styles.headerOuter, { paddingTop: headerPadTop }]} pointerEvents="box-none">
        <BlurView intensity={42} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.headerTint} />
        <View style={styles.headerRow}>
          {onClose ? (
            <Pressable
              onPress={onClose}
              style={styles.headerSide}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={26} color={palette.text} />
            </Pressable>
          ) : (
            <View style={styles.headerSide} />
          )}

          <Text style={styles.headerTitle}>Tea</Text>

          <View style={[styles.headerSide, styles.tabsWrap]}>
            <Pressable
              onPress={() => switchTab('forYou')}
              style={[styles.tabBtn, tab === 'forYou' && styles.tabBtnActive]}
            >
              <Text style={[styles.tabLabel, tab === 'forYou' && styles.tabLabelActive]}>For You</Text>
            </Pressable>
            <Pressable
              onPress={() => switchTab('trending')}
              style={[styles.tabBtn, tab === 'trending' && styles.tabBtnActive]}
            >
              <Text style={[styles.tabLabel, tab === 'trending' && styles.tabLabelActive]}>Trending</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  pager: {
    flex: 1,
  },
  page: {
    backgroundColor: palette.bg,
    justifyContent: 'flex-end',
  },
  cardShell: {
    flex: 1,
    overflow: 'hidden',
  },
  imageWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
  },
  heroImage: {
    maxWidth: '100%',
    maxHeight: '100%',
  },
  bottomBlock: {
    paddingHorizontal: 22,
    paddingRight: 84,
    gap: 10,
    maxWidth: '100%',
  },
  categoryPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: palette.pillBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(168,85,247,0.35)',
  },
  categoryText: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  headline: {
    color: palette.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 32,
  },
  description: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  metaSource: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  metaDot: {
    color: palette.muted,
    fontSize: 13,
  },
  metaTime: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: '500',
  },
  actionsColumn: {
    position: 'absolute',
    right: 14,
    bottom: 120,
    gap: 22,
    alignItems: 'center',
  },
  actionHit: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  headerOuter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.headerTint,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingBottom: 12,
    minHeight: 44,
  },
  headerSide: {
    minWidth: 108,
  },
  headerTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: palette.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
    pointerEvents: 'none',
  },
  tabsWrap: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
    alignItems: 'center',
  },
  tabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  tabBtnActive: {
    backgroundColor: 'rgba(168,85,247,0.22)',
  },
  tabLabel: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: palette.accent,
  },
});
