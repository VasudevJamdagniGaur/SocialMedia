import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signUpUser, getCurrentUser } from '../services/authService';
import firestoreService from '../services/firestoreService';
import LaserFlow from './LaserFlow';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

const ProfileDetailsPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState(null);
  const [birthdayDisplay, setBirthdayDisplay] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [gender, setGender] = useState('');
  const [aboutYou, setAboutYou] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Get email and password from navigation state
  const email = location.state?.email;
  const password = location.state?.password;

  useEffect(() => {
    // If no email/password, redirect back to signup immediately
    if (!email || !password) {
      navigate('/signup', { replace: true });
    }
  }, [email, password, navigate]);
  
  // Don't render the form if email/password are missing
  if (!email || !password) {
    return null; // Will redirect via useEffect
  }

  const calculateAge = (birthDate) => {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const formatDate = (date) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDateDisplay = (date) => {
    if (!date) return '';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  };

  const validate = () => {
    if (!name.trim()) return 'Please enter your name.';
    if (!birthday) return 'Please select your birthday.';
    const age = calculateAge(birthday);
    if (age < 13) return 'You must be at least 13 years old to use this service.';
    if (age > 120) return 'Please enter a valid birthday.';
    if (!gender) return 'Please select your gender.';
    if (!aboutYou.trim()) return 'Please tell us about yourself.';
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Safety check: ensure email and password are available
    if (!email || !password) {
      setError('Missing email or password. Please go back and try again.');
      navigate('/signup', { replace: true });
      return;
    }
    
    const message = validate();
    if (message) {
      setError(message);
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');

      // Create the account with name as displayName
      const result = await signUpUser(email, password, name.trim());
      
      if (result.success) {
        // Get the current user to save profile data
        const user = getCurrentUser();
        if (user) {
          // Create user document in Firestore (for counting authenticated users)
          try {
            await firestoreService.ensureUser(user.uid, {
              email: user.email,
              displayName: user.displayName || name.trim(),
              createdAt: new Date().toISOString()
            });
            console.log('✅ User document created in Firestore');
          } catch (error) {
            console.error('Error creating user document:', error);
            // Don't block signup if this fails
          }
          
          // Calculate age from birthday
          const age = calculateAge(birthday);
          
          // Save profile data to localStorage (used by deite context and profile page)
          localStorage.setItem(`user_age_${user.uid}`, age.toString());
          localStorage.setItem(`user_birthday_${user.uid}`, formatDate(birthday));
          localStorage.setItem(`user_gender_${user.uid}`, gender);
          localStorage.setItem(`user_bio_${user.uid}`, aboutYou.trim());
          
          console.log('✅ Profile data saved:', {
            name: name.trim(),
            age: age,
            birthday: formatDate(birthday),
            gender: gender,
            aboutYou: aboutYou.trim()
          });
        }

        // Navigate to dashboard
        navigate('/dashboard', { replace: true });
      } else {
        setError(result.error || 'Sign up failed. Please try again.');
      }
    } catch (err) {
      setError(err.message || 'Sign up failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse at bottom, #1B2735 0%, #090A0F 100%)',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}
    >
      {/* Stars background */}
      <div className="absolute inset-0 overflow-hidden" style={{ zIndex: 2 }}>
        {[...Array(80)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: Math.random() * 3 + 1 + 'px',
              height: Math.random() * 3 + 1 + 'px',
              left: Math.random() * 100 + '%',
              top: Math.random() * 100 + '%',
              background: 'white',
              boxShadow: `0 0 ${Math.random() * 10 + 2}px rgba(255, 255, 255, ${Math.random() * 0.5 + 0.3})`,
              animation: `twinkle ${Math.random() * 5 + 3}s ease-in-out ${Math.random() * 5}s infinite`,
              opacity: Math.random() * 0.7 + 0.3,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }

        /* Mobile input styling to match app UI */
        .mobile-input {
          background-color: #262626;
          color: #FFFFFF;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        }
        .mobile-input::placeholder {
          color: #9CA3AF; /* gray-400 */
        }
        .mobile-input:focus {
          outline: none;
          border-color: rgba(139, 195, 74, 0.35); /* #8BC34A accent */
          box-shadow: 0 0 0 2px rgba(139, 195, 74, 0.15), 0 4px 16px rgba(0, 0, 0, 0.2);
        }
      `}</style>

      {/* LaserFlow Background */}
      <div 
        style={{ 
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          height: '140vh',
          overflow: 'visible',
          zIndex: 1,
          pointerEvents: 'none'
        }}
      >
        <LaserFlow
          horizontalBeamOffset={0.0}
          verticalBeamOffset={0.2}
          color="#8BC34A"
        />
      </div>

      {/* Centered card */}
      <div className="flex-1 flex items-center justify-center relative p-4" style={{ zIndex: 10 }}>
        <div
          className="mobile-container w-full max-w-md rounded-3xl"
          style={{
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            padding: '24px',
            marginBottom: '32px'
          }}
        >
          <h1 className="text-xl font-semibold mb-6" style={{ color: 'white' }}>Tell us about yourself</h1>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm mb-2" style={{ color: '#cbd5e1' }}>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mobile-button mobile-input w-full px-4 py-3 rounded-xl text-base"
                style={{ 
                  fontSize: '16px',
                  minHeight: '48px'
                }}
                placeholder="Your full name"
                autoComplete="name"
              />
            </div>

            <div>
              <label className="block text-sm mb-2" style={{ color: '#cbd5e1' }}>Birthday</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={birthdayDisplay}
                  onClick={() => setShowCalendar(true)}
                  readOnly
                  className="mobile-button mobile-input w-full px-4 py-3 rounded-xl text-base pr-12 cursor-pointer"
                  style={{ 
                    fontSize: '16px',
                    minHeight: '48px'
                  }}
                  placeholder="Select your birthday"
                />
                <div
                  onClick={() => setShowCalendar(true)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#cbd5e1',
                    cursor: 'pointer'
                  }}
                >
                  <Calendar size={20} />
                </div>
              </div>
            </div>

            {/* Birthday Calendar Popup */}
            {showCalendar && (
              <BirthdayCalendar
                selectedDate={birthday}
                onDateSelect={(date) => {
                  setBirthday(date);
                  setBirthdayDisplay(formatDateDisplay(date));
                  setShowCalendar(false);
                }}
                onClose={() => setShowCalendar(false)}
              />
            )}

            <div>
              <label className="block text-sm mb-3" style={{ color: '#cbd5e1' }}>Gender</label>
              <div className="space-y-2">
                {[
                  { value: 'female', label: 'Female 👩' },
                  { value: 'male', label: 'Male 👨' },
                  { value: 'other', label: 'Other 🌈' },
                ].map((option) => (
                  <label key={option.value} className="cursor-pointer block">
                    <input
                      type="radio"
                      name="gender"
                      value={option.value}
                      checked={gender === option.value}
                      onChange={(e) => setGender(e.target.value)}
                      className="sr-only"
                    />
                    <div
                      className={`p-3 text-center rounded-xl border-2 transition-all duration-300 font-medium ${
                        gender === option.value
                          ? 'border-purple-400 text-white'
                          : 'border-gray-600 text-gray-300 hover:border-gray-500'
                      }`}
                      style={{
                        backgroundColor: gender === option.value
                          ? "rgba(129, 201, 149, 0.2)"
                          : "#262626",
                      }}
                    >
                      {option.label}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm mb-2" style={{ color: '#cbd5e1' }}>About you</label>
              <textarea
                value={aboutYou}
                onChange={(e) => setAboutYou(e.target.value)}
                className="mobile-button mobile-input w-full px-4 py-3 rounded-xl text-base resize-none"
                style={{ 
                  fontSize: '16px',
                  minHeight: '100px'
                }}
                placeholder="How are you feeling these days?"
                rows="4"
              />
            </div>

            {error && (
              <div className="text-sm py-2" style={{ color: '#F28B82' }}>{error}</div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mobile-button w-full rounded-2xl font-semibold transition-all duration-300 active:scale-[0.98]"
              style={{ 
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.9)',
                padding: '14px 16px',
                opacity: isSubmitting ? 0.7 : 1,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                minHeight: '48px',
                fontSize: '16px'
              }}
            >
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </button>

            <button
              type="button"
              onClick={() => navigate('/signup')}
              className="mobile-button w-full rounded-2xl font-semibold transition-all duration-300 active:scale-[0.98]"
              style={{ 
                background: 'transparent', 
                color: 'rgba(255, 255, 255, 0.9)', 
                padding: '14px 16px', 
                border: '1px solid rgba(255, 255, 255, 0.3)', 
                backdropFilter: 'blur(10px)',
                minHeight: '48px',
                fontSize: '16px'
              }}
            >
              Back
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// Birthday Calendar Component
const BirthdayCalendar = ({ selectedDate, onDateSelect, onClose }) => {
  const [currentMonth, setCurrentMonth] = useState(selectedDate || new Date());
  const [isAnimating, setIsAnimating] = useState(false);
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar', 'year', 'month'
  const [selectedYear, setSelectedYear] = useState(null);
  
  // Year picker scroll state
  const [yearScrollPosition, setYearScrollPosition] = useState(0);
  const yearScrollContainerRef = useRef(null);
  
  // Month picker scroll state
  const [monthScrollPosition, setMonthScrollPosition] = useState(0);
  const monthScrollContainerRef = useRef(null);

  // Initialize selected year
  useEffect(() => {
    const today = new Date();
    const maxYear = today.getFullYear() - 13;
    const minYear = today.getFullYear() - 120;
    
    if (selectedDate) {
      const year = Math.min(Math.max(selectedDate.getFullYear(), minYear), maxYear);
      setCurrentMonth(new Date(year, selectedDate.getMonth(), 1));
      setSelectedYear(year);
    } else {
      const defaultYear = Math.min(Math.max(2005, minYear), maxYear);
      setSelectedYear(defaultYear);
    }
  }, [selectedDate]);

  // Scroll to current year when year picker opens
  useEffect(() => {
    if (
      viewMode === 'year' &&
      yearScrollContainerRef.current
    ) {
      const years = getYearRange();
      const targetYear = selectedYear ?? years[years.length - 1];
      const currentYearIndex = years.findIndex(y => y === targetYear);
      if (currentYearIndex >= 0) {
        const itemHeight = 50;
        const scrollTo = currentYearIndex * itemHeight;
        setTimeout(() => {
          if (yearScrollContainerRef.current) {
            yearScrollContainerRef.current.scrollTop = scrollTo;
            setYearScrollPosition(scrollTo);
          }
        }, 100);
      }
    }
  }, [viewMode, selectedYear]);

  // Scroll to current month when month picker opens
  useEffect(() => {
    if (viewMode === 'month' && monthScrollContainerRef.current) {
      const currentMonthIndex = currentMonth.getMonth();
      const itemHeight = 50;
      const scrollTo = currentMonthIndex * itemHeight;
      setTimeout(() => {
        if (monthScrollContainerRef.current) {
          monthScrollContainerRef.current.scrollTop = scrollTo;
          setMonthScrollPosition(scrollTo);
        }
      }, 100);
    }
  }, [viewMode, currentMonth]);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    return days;
  };

  const handlePreviousMonth = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
      setIsAnimating(false);
    }, 150);
  };

  const handleNextMonth = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
      setIsAnimating(false);
    }, 150);
  };

  const handleDateClick = (date) => {
    // Don't allow future dates
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (date > today) {
      return;
    }
    onDateSelect(date);
  };

  const isSelected = (date) => {
    return date && selectedDate &&
           date.getDate() === selectedDate.getDate() &&
           date.getMonth() === selectedDate.getMonth() &&
           date.getFullYear() === selectedDate.getFullYear();
  };

  const isFuture = (date) => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date > today;
  };

  const handleHeaderClick = () => {
    if (viewMode === 'calendar') {
      setViewMode('year');
    } else if (viewMode === 'year') {
      setViewMode('calendar');
    } else if (viewMode === 'month') {
      setViewMode('year');
    }
  };

  const handleYearSelect = (year) => {
    setSelectedYear(year);
    setCurrentMonth(new Date(year, currentMonth.getMonth(), 1));
    setViewMode('month');
  };

  const handleMonthSelect = (monthIndex) => {
    setCurrentMonth(new Date(selectedYear, monthIndex, 1));
    setViewMode('calendar');
  };

  const getYearRange = () => {
    const today = new Date();
    const maxYear = today.getFullYear() - 13; // At least 13 years old
    const minYear = today.getFullYear() - 120; // Max 120 years old
    const years = [];
    // Newest year first (scroll up to go to lower years)
    for (let year = maxYear; year >= minYear; year--) {
      years.push(year);
    }
    return years;
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const days = getDaysInMonth(currentMonth);
  const today = new Date();
  const maxDate = new Date(today.getFullYear() - 13, today.getMonth(), today.getDate()); // At least 13 years old
  const minDate = new Date(today.getFullYear() - 120, today.getMonth(), today.getDate()); // Max 120 years old

  // Helper functions for year picker
  const handleYearScroll = (e) => {
    const scrollTop = e.target.scrollTop;
    setYearScrollPosition(scrollTop);
    // Removed auto-selection - user must click to select
  };

  const getYearItemOpacity = (index) => {
    const itemHeight = 50;
    const centerIndex = Math.round(yearScrollPosition / itemHeight);
    const distance = Math.abs(index - centerIndex);
    if (distance === 0) return 1;
    if (distance === 1) return 0.6;
    if (distance === 2) return 0.4;
    return 0.2;
  };

  const getYearItemScale = (index) => {
    const itemHeight = 50;
    const centerIndex = Math.round(yearScrollPosition / itemHeight);
    const distance = Math.abs(index - centerIndex);
    if (distance === 0) return 1;
    if (distance === 1) return 0.9;
    return 0.8;
  };

  // Helper functions for month picker
  const handleMonthScroll = (e) => {
    const scrollTop = e.target.scrollTop;
    setMonthScrollPosition(scrollTop);
    // Removed auto-selection - user must click to select
  };

  const getMonthItemOpacity = (index) => {
    const itemHeight = 50;
    const centerIndex = Math.round(monthScrollPosition / itemHeight);
    const distance = Math.abs(index - centerIndex);
    if (distance === 0) return 1;
    if (distance === 1) return 0.6;
    if (distance === 2) return 0.4;
    return 0.2;
  };

  const getMonthItemScale = (index) => {
    const itemHeight = 50;
    const centerIndex = Math.round(monthScrollPosition / itemHeight);
    const distance = Math.abs(index - centerIndex);
    if (distance === 0) return 1;
    if (distance === 1) return 0.9;
    return 0.8;
  };

  // Year Picker View - Wheel picker
  if (viewMode === 'year') {
    const years = getYearRange();
    const currentYear = selectedYear || currentMonth.getFullYear();
    const itemHeight = 50;


    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ zIndex: 1000 }}>
        <div 
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
        <div
          className="relative rounded-2xl p-6 max-w-sm w-full backdrop-blur-lg animate-in zoom-in-95 duration-300"
          style={{
            backgroundColor: "#262626",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div className="flex items-center justify-center mb-4 pb-4 border-b border-gray-700/50">
            <button
              onClick={handleHeaderClick}
              className="text-lg font-semibold text-white hover:opacity-80 transition-opacity cursor-pointer"
            >
              Select Year
            </button>
          </div>
          
          {/* Wheel Picker Container */}
          <div className="relative" style={{ height: '250px', overflow: 'hidden' }}>
            {/* Selection indicator lines */}
            <div 
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
                height: `${itemHeight}px`,
                borderTop: '1px solid rgba(255, 255, 255, 0.2)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
                zIndex: 1
              }}
            />
            
            {/* Scrollable list */}
            <div
              ref={yearScrollContainerRef}
              onScroll={handleYearScroll}
              className="overflow-y-scroll h-full"
              style={{
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                scrollSnapType: 'y mandatory',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              <style>{`
                div::-webkit-scrollbar {
                  display: none;
                }
              `}</style>
              
              {/* Top padding for centering */}
              <div style={{ height: '100px' }} />
              
              {/* Year items */}
              {years.map((year, index) => {
                const opacity = getYearItemOpacity(index);
                const scale = getYearItemScale(index);
                const isCenter = Math.round(yearScrollPosition / itemHeight) === index;
                
                return (
                  <div
                    key={year}
                    onClick={() => {
                      handleYearSelect(year);
                    }}
                    className="flex items-center justify-center cursor-pointer transition-all duration-150"
                    style={{
                      height: `${itemHeight}px`,
                      opacity: opacity,
                      transform: `scale(${scale})`,
                      color: isCenter ? '#FFFFFF' : '#9CA3AF',
                      fontWeight: isCenter ? '600' : '400',
                      fontSize: isCenter ? '20px' : '18px',
                      scrollSnapAlign: 'center'
                    }}
                  >
                    {year}
                  </div>
                );
              })}
              
              {/* Bottom padding for centering */}
              <div style={{ height: '100px' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Month Picker View - Wheel picker
  if (viewMode === 'month') {
    const itemHeight = 50;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ zIndex: 1000 }}>
        <div 
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
        <div
          className="relative rounded-2xl p-6 max-w-sm w-full backdrop-blur-lg animate-in zoom-in-95 duration-300"
          style={{
            backgroundColor: "#262626",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div className="flex items-center justify-center mb-4 pb-4 border-b border-gray-700/50">
            <button
              onClick={handleHeaderClick}
              className="text-lg font-semibold text-white hover:opacity-80 transition-opacity cursor-pointer"
            >
              {selectedYear}
            </button>
          </div>
          
          {/* Wheel Picker Container */}
          <div className="relative" style={{ height: '250px', overflow: 'hidden' }}>
            {/* Selection indicator lines */}
            <div 
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
                height: `${itemHeight}px`,
                borderTop: '1px solid rgba(255, 255, 255, 0.2)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
                zIndex: 1
              }}
            />
            
            {/* Scrollable list */}
            <div
              ref={monthScrollContainerRef}
              onScroll={handleMonthScroll}
              className="overflow-y-scroll h-full"
              style={{
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                scrollSnapType: 'y mandatory',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              <style>{`
                div::-webkit-scrollbar {
                  display: none;
                }
              `}</style>
              
              {/* Top padding for centering */}
              <div style={{ height: '100px' }} />
              
              {/* Month items */}
              {monthNames.map((month, index) => {
                const opacity = getMonthItemOpacity(index);
                const scale = getMonthItemScale(index);
                const isCenter = Math.round(monthScrollPosition / itemHeight) === index;
                
                return (
                  <div
                    key={index}
                    onClick={() => {
                      handleMonthSelect(index);
                    }}
                    className="flex items-center justify-center cursor-pointer transition-all duration-150"
                    style={{
                      height: `${itemHeight}px`,
                      opacity: opacity,
                      transform: `scale(${scale})`,
                      color: isCenter ? '#FFFFFF' : '#9CA3AF',
                      fontWeight: isCenter ? '600' : '400',
                      fontSize: isCenter ? '20px' : '18px',
                      scrollSnapAlign: 'center'
                    }}
                  >
                    {month}
                  </div>
                );
              })}
              
              {/* Bottom padding for centering */}
              <div style={{ height: '100px' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Calendar View (default)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ zIndex: 1000 }}>
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Calendar */}
      <div
        className="relative rounded-2xl p-6 max-w-sm w-full backdrop-blur-lg animate-in zoom-in-95 duration-300"
        style={{
          backgroundColor: "#262626",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={handlePreviousMonth}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-700/30 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-300" />
          </button>
          
          <div className="text-center">
            <button
              onClick={handleHeaderClick}
              className={`text-lg font-semibold text-white transition-opacity duration-150 hover:opacity-80 cursor-pointer ${
                isAnimating ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </button>
          </div>
          
          <button
            onClick={handleNextMonth}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-700/30 transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-300" />
          </button>
        </div>

        {/* Day names */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {dayNames.map((day) => (
            <div key={day} className="text-center py-2">
              <span className="text-xs font-medium text-gray-400">{day}</span>
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className={`grid grid-cols-7 gap-1 transition-opacity duration-150 ${
          isAnimating ? 'opacity-0' : 'opacity-100'
        }`}>
          {days.map((date, index) => (
            <div key={index} className="aspect-square">
              {date ? (
                <button
                  onClick={() => handleDateClick(date)}
                  disabled={isFuture(date)}
                  className={`w-full h-full rounded-lg flex items-center justify-center text-sm font-medium transition-all duration-200 ${
                    isSelected(date)
                      ? 'text-black font-bold shadow-lg'
                      : isFuture(date)
                      ? 'text-gray-600 cursor-not-allowed opacity-30'
                      : 'text-gray-300 hover:bg-gray-700/30 hover:text-white'
                  }`}
                  style={
                    isSelected(date)
                      ? {
                          backgroundColor: "rgba(129, 201, 149, 0.9)",
                          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
                          border: "1px solid rgba(255, 255, 255, 0.08)",
                        }
                      : {}
                  }
                >
                  {date.getDate()}
                </button>
              ) : (
                <div className="w-full h-full" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProfileDetailsPage;

