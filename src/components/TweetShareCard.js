import React from 'react';

/**
 * Tweet-style card used only for X sharing.
 * Rendered off-screen and converted to an image.
 */
const TweetShareCard = React.forwardRef(function TweetShareCard(props, ref) {
  const {
    displayName = 'DeTea User',
    username = 'detea_user',
    text,
    imageUrl,
    profileImageUrl,
    width = 1080,
    height, // optional; if omitted we derive from width using 7:10 aspect ratio
  } = props;

  // Normalize numeric width/height and enforce width : height = 7 : 10 when height is not provided
  const numericWidth = typeof width === 'number' ? width : 1080;
  const numericHeight =
    typeof height === 'number' ? height : Math.round((numericWidth * 10) / 7);

  // Top section (header + text): ~22% of card height; image: ~73%; watermark: ~5%
  const topSectionHeight = Math.round(numericHeight * 0.22);
  const imageSectionHeight = Math.round(numericHeight * 0.73);
  const watermarkHeight = Math.round(numericHeight * 0.05);

  return (
    <div
      ref={ref}
      style={{
        width: numericWidth,
        height: numericHeight,
        borderRadius: 40,
        border: '1px solid #D1D5DB',
        backgroundColor: '#FFFFFF',
        padding: 36,
        boxSizing: 'border-box',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
        {/* Top: Header + tweet text — ~20–25% of card (like reference) */}
        <div
          style={{
            flex: '0 0 auto',
            height: topSectionHeight,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            minHeight: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                overflow: 'hidden',
                marginRight: 20,
                background:
                  'linear-gradient(135deg, rgba(37,99,235,0.4), rgba(79,70,229,0.5))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {profileImageUrl ? (
                <img
                  src={profileImageUrl}
                  alt={displayName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: '#FFFFFF',
                  }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 700,
                  color: '#0F1419',
                  lineHeight: 1.2,
                }}
              >
                {displayName}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 24,
                  color: '#536471',
                }}
              >
                @{username}
              </div>
            </div>
          </div>
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.5,
              color: '#0F1419',
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {text}
          </div>
        </div>

        {/* Image — ~75–80% of card; always show area so layout is consistent */}
        <div
          style={{
            flex: '1 1 auto',
            minHeight: imageSectionHeight,
            marginTop: 16,
            borderRadius: 24,
            overflow: 'hidden',
            border: '1px solid #D1D5DB',
            backgroundColor: imageUrl ? 'transparent' : '#F3F4F6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : null}
        </div>

        {/* Watermark */}
        <div
          style={{
            flex: '0 0 auto',
            height: watermarkHeight,
            marginTop: 12,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 20,
              color: '#6B7280',
            }}
          >
            Created with DeTea
          </span>
        </div>
    </div>
  );
});

export default TweetShareCard;

