# Deite - Emotional Wellness App

A beautiful and intuitive emotional wellness companion app built with React. Deite helps users track their emotional journey, chat with an AI companion, and maintain mental wellness through reflection and insights.

## Features

### 🌟 Core Features
- **Splash Screen**: Beautiful animated introduction with cloud formations and floating icons
- **Landing Page**: Elegant welcome screen with gradient backgrounds and smooth animations
- **Welcome Page**: Feature showcase with cards highlighting app benefits
- **Authentication**: Sign up and login pages with form validation
- **Dashboard**: Central hub with date navigation and reflection display
- **AI Chat**: Conversational AI companion for emotional support
- **Emotional History**: Visual charts and insights showing emotional trends
- **Daily Reflections**: Auto-generated summaries based on chat conversations

### 🎨 Design Elements
- **Gradient Backgrounds**: Dark theme with blue-to-dark gradients
- **Glassmorphism**: Backdrop blur effects and translucent surfaces
- **Animated Icons**: Floating hearts and stars with staggered animations
- **Cloud Formations**: Subtle SVG line art for atmospheric depth
- **Color Palette**: 
  - Teal: `#7DD3C0`
  - Gold: `#D4AF37` 
  - Blue: `#9BB5FF`
  - Dark Primary: `#0B0E14`
  - Dark Secondary: `#1C1F2E`

### 🤖 AI Features
- **Contextual Responses**: AI responds based on emotional keywords and context
- **Conversation History**: Persistent chat storage across sessions
- **Reflection Generation**: Automatic daily summaries from conversations
- **Emotional Analysis**: Mood tracking and trend visualization

### 📊 Data Visualization
- **Mood Trends**: 7-day line charts showing emotional patterns
- **Mood Distribution**: Pie charts displaying emotion frequency
- **Recent Check-ins**: Timeline of recent emotional states
- **Intensity Tracking**: 1-10 scale emotional intensity measurements

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Installation

1. **Clone or download the project files**

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install Tailwind CSS**
   ```bash
   npm install -D tailwindcss postcss autoprefixer
   npx tailwindcss init -p
   ```

4. **Start the development server**
   ```bash
   npm start
   ```

5. **Open your browser**
   Navigate to `http://127.0.0.1:3000`

## App Flow

1. **Splash Screen** (3 seconds) → **Landing Page**
2. **Landing Page** → **Welcome Page** (via "Get Started")
3. **Welcome Page** → **Sign Up Page** (via "Go")
4. **Sign Up/Login** → **Dashboard**
5. **Dashboard** → **Chat** (AI conversation)
6. **Dashboard** → **Emotional History** (trends and insights)

## File Structure

```
src/
├── components/
│   ├── SplashScreen.js      # Animated loading screen
│   ├── LandingPage.js       # Main landing page
│   ├── WelcomePage.js       # Feature showcase
│   ├── SignupPage.js        # User registration
│   ├── LoginPage.js         # User authentication
│   ├── DashboardPage.js     # Main dashboard
│   ├── ChatPage.js          # AI conversation interface
│   └── EmotionalHistory.js  # Charts and insights
├── App.js                   # Main app with routing
├── index.js                 # React entry point
└── index.css               # Global styles with Tailwind
```

## Key Features Explained

### AI Chat System
- Detects emotional keywords (sad, anxious, happy, etc.)
- Provides contextually appropriate responses
- Stores conversation history in localStorage
- Generates daily reflections automatically

### Reflection Generation
After each chat session, the app automatically creates a reflection entry that appears on the dashboard. This provides users with a summary of their emotional journey.

### Data Persistence
- Chat messages: localStorage
- Daily reflections: localStorage (keyed by date)
- Emotional history: Generated from conversation patterns

### Responsive Design
- Mobile-first design approach
- Optimized for various screen sizes
- Smooth animations and transitions
- Touch-friendly interactive elements

## Customization

### API Integration
To connect with a real AI service, modify the `sendMessageToAI` function in `ChatPage.js`:

```javascript
const sendMessageToAI = async (userMessage, conversationHistory) => {
  const response = await fetch('YOUR_AI_API_ENDPOINT', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_API_KEY'
    },
    body: JSON.stringify({
      message: userMessage,
      history: conversationHistory,
      systemPrompt: "You are Deite, an AI mental health companion..."
    })
  });
  
  const data = await response.json();
  return data.response;
};
```

### Styling Customization
Modify colors and themes in:
- `tailwind.config.js` for color palette
- `src/index.css` for global styles
- Individual component files for specific styling

## Dependencies

- **React**: UI framework
- **React Router**: Navigation and routing
- **Lucide React**: Icon library
- **Recharts**: Chart and visualization library
- **Tailwind CSS**: Utility-first CSS framework

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Performance Notes

- Lazy loading for chat messages
- Optimized SVG animations
- Efficient localStorage usage
- Smooth 60fps animations

## Future Enhancements

- Real-time AI integration
- User authentication backend
- Cloud data synchronization
- Advanced emotional analytics
- Push notifications for check-ins
- Social features and community support

---

**Deite** - Your companion for emotional wellness and mental health journey. 🧠💚


