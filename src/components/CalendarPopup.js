import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const CalendarPopup = ({ isOpen, onClose, selectedDate, onDateSelect, chatDays = [] }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isAnimating, setIsAnimating] = useState(false);

  // Match Community / app theme (THREADS)
  const THREADS = {
    bg: '#0F0F0F',
    bgSecondary: '#121212',
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    divider: '#1E1E1E',
    accent: '#E91E63',
  };

  useEffect(() => {
    if (selectedDate) {
      setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  }, [selectedDate]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // Add all days of the month
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
    onDateSelect(date);
    onClose();
  };

  const isToday = (date) => {
    const today = new Date();
    return date && 
           date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  };

  const isSelected = (date) => {
    return date && selectedDate &&
           date.getDate() === selectedDate.getDate() &&
           date.getMonth() === selectedDate.getMonth() &&
           date.getFullYear() === selectedDate.getFullYear();
  };

  const hasChatActivity = (date) => {
    if (!date || !chatDays || chatDays.length === 0) return false;
    
    // Format date as YYYY-MM-DD to match dateId format (same as getDateId function)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateId = `${year}-${month}-${day}`;
    
    console.log('🔍 CALENDAR DEBUG: Checking chat activity for date:', dateId);
    console.log('🔍 CALENDAR DEBUG: Available chat days:', chatDays.map(d => d.date || d.id));
    
    // Check if this dateId exists in chatDays
    const hasActivity = chatDays.some(chatDay => chatDay.date === dateId || chatDay.id === dateId);
    console.log('🔍 CALENDAR DEBUG: Has chat activity:', hasActivity);
    
    return hasActivity;
  };


  const days = getDaysInMonth(currentMonth);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Calendar */}
      <div
        className="relative rounded-2xl p-6 max-w-sm w-full backdrop-blur-lg animate-in zoom-in-95 duration-300"
        style={{
          backgroundColor: THREADS.bgSecondary,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
          border: `1px solid ${THREADS.divider}`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={handlePreviousMonth}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:opacity-80"
            style={{ color: THREADS.text }}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <div className="text-center">
            <h3 className={`text-lg font-semibold transition-opacity duration-150 ${
              isAnimating ? 'opacity-0' : 'opacity-100'
            }`} style={{ color: THREADS.text }}>
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </h3>
          </div>
          
          <button
            onClick={handleNextMonth}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:opacity-80"
            style={{ color: THREADS.text }}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Day names */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {dayNames.map((day) => (
            <div key={day} className="text-center py-2">
              <span className="text-xs font-medium" style={{ color: THREADS.textSecondary }}>{day}</span>
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
                <div className="relative w-full h-full">
                  <button
                    onClick={() => handleDateClick(date)}
                    className="w-full h-full rounded-lg flex items-center justify-center text-sm font-medium transition-all duration-200 hover:scale-105 hover:bg-white/10"
                    style={
                      isSelected(date)
                        ? {
                            backgroundColor: THREADS.accent,
                            color: THREADS.text,
                            boxShadow: `0 4px 12px ${THREADS.accent}50`,
                            border: `1px solid ${THREADS.accent}`,
                          }
                        : isToday(date)
                        ? {
                            color: THREADS.text,
                            backgroundColor: THREADS.divider,
                            border: `1px solid ${THREADS.accent}60`,
                          }
                        : {
                            color: THREADS.text,
                            backgroundColor: 'transparent',
                          }
                    }
                  >
                    {date.getDate()}
                  </button>
                  {/* Activity indicators */}
                  {!isSelected(date) && (
                    <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 flex space-x-1">
                      {hasChatActivity(date) && (
                        <div 
                          className="rounded-full"
                          style={{
                            width: '5px',
                            height: '5px',
                            backgroundColor: THREADS.accent,
                            boxShadow: `0 0 6px ${THREADS.accent}80`,
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full h-full" />
              )}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-4 flex justify-center space-x-4 text-xs">
          <div className="flex items-center space-x-1">
            <div 
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: THREADS.accent,
                boxShadow: `0 0 4px ${THREADS.accent}80`,
              }}
            />
            <span style={{ color: THREADS.textSecondary }}>Chat</span>
          </div>
        </div>

        {/* Today button */}
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => handleDateClick(new Date())}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:opacity-90"
            style={{
              backgroundColor: THREADS.accent,
              color: THREADS.text,
              border: `1px solid ${THREADS.accent}`,
            }}
          >
            Go to Today
          </button>
        </div>
      </div>
    </div>
  );
};

export default CalendarPopup;
