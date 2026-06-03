import React, { useRef, useEffect, useState } from 'react';
import './Shuffle.css';

const Shuffle = ({
  text,
  className = '',
  style = {},
  duration = 0.35,
  ease = 'power3.out',
  tag = 'span',
  textAlign = 'center',
  onShuffleComplete,
  scrambleCharset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*',
  threshold = 0.1,
  triggerOnce = true,
  triggerOnHover = true,
  respectReducedMotion = true,
  stagger = 0.03,
}) => {
  const ref = useRef(null);
  const [displayText, setDisplayText] = useState(text);
  const [ready, setReady] = useState(threshold === 0);
  const animationRef = useRef(null);
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (respectReducedMotion && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayText(text);
      setReady(true);
      onShuffleComplete?.();
      return;
    }

    // Reset animation flag when text changes
    hasAnimatedRef.current = false;
    
    const animate = () => {
      if (hasAnimatedRef.current && triggerOnce) return;
      hasAnimatedRef.current = true;

      const chars = text.split('');
      const totalFrames = Math.floor((duration * 1000) / 16); // ~60fps
      let frame = 0;

      const scramble = () => {
        if (frame >= totalFrames) {
          setDisplayText(text);
          setReady(true);
          onShuffleComplete?.();
          return;
        }

        const progress = frame / totalFrames;
        
        // Create scrambled text where each character settles at different times based on stagger
        const scrambled = chars.map((char, index) => {
          // Calculate when this character should settle (staggered)
          const charProgress = Math.min(1, Math.max(0, (progress - (index * stagger / duration)) / (1 - (index * stagger / duration))));
          
          if (char === ' ') return ' ';
          
          // Use easing function for smooth settling
          const easedProgress = easeOutCubic(charProgress);
          
          // Character settles when its progress reaches ~0.7
          if (easedProgress > 0.7) {
            return char;
          }
          
          // Random character from charset
          return scrambleCharset[Math.floor(Math.random() * scrambleCharset.length)];
        }).join('');

        setDisplayText(scrambled);
        frame++;
        animationRef.current = requestAnimationFrame(scramble);
      };

      setReady(true);
      scramble();
    };

    // Trigger animation based on threshold
    if (threshold === 0) {
      // Immediate trigger
      setTimeout(animate, 100);
    } else {
      // Intersection Observer for scroll trigger
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              animate();
              if (triggerOnce) {
                observer.disconnect();
              }
            }
          });
        },
        { threshold }
      );

      if (ref.current) {
        observer.observe(ref.current);
      }

      return () => {
        observer.disconnect();
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [text, duration, scrambleCharset, threshold, triggerOnce, stagger, onShuffleComplete, respectReducedMotion]);

  // Hover trigger
  useEffect(() => {
    if (!triggerOnHover || !ref.current) return;

    const handleMouseEnter = () => {
      if (triggerOnce && hasAnimatedRef.current) return;
      hasAnimatedRef.current = false;
      
      const chars = text.split('');
      const totalFrames = Math.floor((duration * 1000) / 16);
      let frame = 0;

      const scramble = () => {
        if (frame >= totalFrames) {
          setDisplayText(text);
          onShuffleComplete?.();
          return;
        }

        const progress = frame / totalFrames;
        
        const scrambled = chars.map((char, index) => {
          const charProgress = Math.min(1, Math.max(0, (progress - (index * stagger / duration)) / (1 - (index * stagger / duration))));
          
          if (char === ' ') return ' ';
          
          const easedProgress = easeOutCubic(charProgress);
          
          if (easedProgress > 0.7) {
            return char;
          }
          
          return scrambleCharset[Math.floor(Math.random() * scrambleCharset.length)];
        }).join('');

        setDisplayText(scrambled);
        frame++;
        animationRef.current = requestAnimationFrame(scramble);
      };

      scramble();
    };

    ref.current.addEventListener('mouseenter', handleMouseEnter);
    const currentRef = ref.current;

    return () => {
      if (currentRef) {
        currentRef.removeEventListener('mouseenter', handleMouseEnter);
      }
    };
  }, [text, duration, scrambleCharset, triggerOnHover, triggerOnce, stagger, onShuffleComplete]);

  const commonStyle = { textAlign, ...style };
  const classes = `shuffle-parent ${ready ? 'is-ready' : ''} ${className}`;
  const Tag = tag || 'span';
  
  return React.createElement(Tag, { 
    ref: ref, 
    className: classes, 
    style: commonStyle 
  }, displayText);
};

// Easing function for smooth animation
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export default Shuffle;
