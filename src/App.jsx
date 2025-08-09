import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { 
    getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, 
    onSnapshot, collection, query, where, getDocs, writeBatch, serverTimestamp, Timestamp 
} from 'firebase/firestore';
import { Calendar, Settings, X, Plus, Trash2, MoreVertical, Check, User, Users, Clock, Tag, DollarSign, GripVertical, Search, Phone, Mail, PackagePlus, ChevronLeft, ChevronRight, CaseUpper, FileText, ShoppingCart, GlassWater, Pizza, Gift, Ticket, Link2, MapPin, AlertTriangle, Ban, Info, ChevronsUpDown, RotateCcw, Edit } from 'lucide-react';

// --- Firebase Configuration ---
// This configuration is provided and should be used to initialize Firebase.
const firebaseConfig = {
    apiKey: "AIzaSyA3NJOCZe2zFw6Ueu5gBt9o2UgFgvU8eI0",
    authDomain: "serve-social-booking.firebaseapp.com",
    projectId: "serve-social-booking",
    storageBucket: "serve-social-booking.appspot.com",
    messagingSenderId: "279115505018",
    appId: "1:279115505018:web:204a8be5d1c11934628ac3",
    measurementId: "G-F69VTE72T1"
};


// --- Helper Functions & Constants ---
const timeSlots = Array.from({ length: 15 * 4 + 1 }, (_, i) => {
    const hour = 8 + Math.floor(i / 4);
    const minute = (i % 4) * 15;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});

const BOOKING_STATUS_COLORS = {
    Booked: 'bg-blue-600/80 border-blue-400',
    'Checked In': 'bg-yellow-500/80 border-yellow-300',
    Done: 'bg-green-600/80 border-green-400',
};

const BOOKING_STATUSES = ['Booked', 'Checked In', 'Done'];
const ROW_HEIGHT_REM = 2.5; // Corresponds to h-10 (40px)
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];


const ADD_ON_ICONS = {
    'Default': ShoppingCart,
    'Drink': GlassWater,
    'Food': Pizza,
    'Gift': Gift,
    'Ticket': Ticket,
};

const AddOnIcon = ({ name, ...props }) => {
    const Icon = ADD_ON_ICONS[name] || ShoppingCart;
    return <Icon {...props} />;
};

const calculateBookingPrice = (booking, activities, addOns) => {
    if (!booking) return 0;
    const { groupSize = 0, items = [], selectedAddOns = [] } = booking;
    const numGroupSize = Number(groupSize) || 0;
    if (numGroupSize < 1) return 0;

    const activitiesTotal = items.reduce((acc, item) => {
        const activity = activities.find(a => a.id === item.activityId);
        if (!activity) return acc;

        let itemPrice = 0;
        if (activity.type === 'Fixed Time') {
            itemPrice = activity.price;
        } else { // Flexi Time
            const pricePerSlot = activity.price;
            const slots = item.duration / 15;
            itemPrice = pricePerSlot * slots;
        }
        return acc + itemPrice;
    }, 0);

    const addOnsTotal = selectedAddOns.reduce((acc, selected) => {
        const addOn = addOns.find(a => a.id === selected.addOnId);
        if (!addOn) return acc;
        return acc + (addOn.price * selected.quantity);
    }, 0);

    return (activitiesTotal * numGroupSize) + addOnsTotal;
};


// --- Main App Component ---
export default function App() {
    // --- State Management ---
    const [view, setView] = useState('timeline'); // 'timeline' or 'settings'
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [appId] = useState('default-app-id'); // Hardcoded for persistence
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [showCalendar, setShowCalendar] = useState(false);

    const [activities, setActivities] = useState([]);
    const [resources, setResources] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [addOns, setAddOns] = useState([]);
    const [resourceLinks, setResourceLinks] = useState([]);
    const [areas, setAreas] = useState([]);
    const [scheduleOverrides, setScheduleOverrides] = useState([]);
    const [closures, setClosures] = useState([]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingBooking, setEditingBooking] = useState(null);
    const [modalInitialData, setModalInitialData] = useState({});

    // --- Firebase Initialization and Auth ---
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                } else if (!firebaseAuth.currentUser) {
                    try {
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(firebaseAuth, __initial_auth_token);
                        } else {
                            await signInAnonymously(firebaseAuth);
                        }
                    } catch (error) {
                         console.log(`Custom token sign-in failed: ${error.message}. Falling back to anonymous login.`);
                        try {
                            await signInAnonymously(firebaseAuth);
                        } catch (anonError) {
                            setError(`Authentication failed completely: ${anonError.message}`);
                        }
                    }
                }
            });
            return () => unsubscribe();
        } catch(e) {
            setError(`Firebase initialization failed: ${e.message}`);
        }
    }, []);


    // --- Firestore Data Subscriptions ---
    useEffect(() => {
        if (!isAuthReady || !db) return;

        setLoading(true);
        const collections = ['activities', 'resources', 'bookings', 'customers', 'addOns', 'resourceLinks', 'areas', 'scheduleOverrides', 'closures'];
        let loadedCount = 0;

        const unsubscribers = collections.map(collectionName => {
            const q = query(collection(db, `artifacts/${appId}/public/data/${collectionName}`));
            return onSnapshot(q, (querySnapshot) => {
                const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                switch (collectionName) {
                    case 'activities': setActivities(data.sort((a, b) => a.name.localeCompare(b.name))); break;
                    case 'resources': setResources(data.sort((a, b) => a.name.localeCompare(b.name))); break;
                    case 'bookings': 
                        const parsedBookings = data.map(b => ({
                            ...b,
                            items: (b.items || []).map(item => ({
                                ...item,
                                startTime: item.startTime instanceof Timestamp ? item.startTime.toDate() : new Date(item.startTime)
                            })),
                            payments: (b.payments || []).map((p, index) => ({
                                ...p,
                                id: p.id || Date.now() + index, // Ensure every payment has a unique ID
                                date: p.date instanceof Timestamp ? p.date.toDate() : new Date(p.date)
                            }))
                        }));
                        setBookings(parsedBookings); 
                        break;
                    case 'customers': setCustomers(data); break;
                    case 'addOns': setAddOns(data.sort((a, b) => a.name.localeCompare(b.name))); break;
                    case 'resourceLinks': setResourceLinks(data); break;
                    case 'areas': setAreas(data.sort((a, b) => a.name.localeCompare(b.name))); break;
                    case 'scheduleOverrides': 
                        const parsedOverrides = data.map(o => ({
                            ...o,
                            date: o.date instanceof Timestamp ? o.date.toDate() : new Date(o.date)
                        }));
                        setScheduleOverrides(parsedOverrides);
                        break;
                    case 'closures':
                        const parsedClosures = data.map(c => ({
                            ...c,
                            date: c.date instanceof Timestamp ? c.date.toDate() : new Date(c.date)
                        }));
                        setClosures(parsedClosures);
                        break;
                    default: break;
                }
                loadedCount++;
                if (loadedCount === collections.length) {
                    setLoading(false);
                }
            }, (err) => {
                setError(`Failed to load ${collectionName}. Check permissions and path.`);
                setLoading(false);
            });
        });
        
        return () => unsubscribers.forEach(unsub => unsub());
    }, [isAuthReady, db, appId]);

    // --- Event Handlers for Booking Modal ---
    const handleOpenBookingModal = (booking = null, initialTime = null, resourceId = null) => {
        setEditingBooking(booking);
        let initialData = {};
        if (initialTime && resourceId) {
             const resource = resources.find(r => r.id === resourceId);
             if (resource) {
                 initialData = {
                     items: [{
                         id: Date.now(),
                         activityId: resource.activityId,
                         resourceIds: [resourceId],
                         startTime: initialTime,
                         duration: 60
                     }]
                 };
             }
        }
        setModalInitialData(initialData);
        setIsModalOpen(true);
    };
    
    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingBooking(null);
        setModalInitialData({});
    };

    const handleDateChange = (offset) => {
        setSelectedDate(prev => {
            const newDate = new Date(prev);
            newDate.setDate(newDate.getDate() + offset);
            return newDate;
        });
    };
    
    const shortDate = selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const longDate = selectedDate.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

    return (
        <div className="bg-gray-900 text-gray-200 font-sans min-h-screen flex flex-col">
            <header className="bg-gray-800/80 backdrop-blur-md border-b border-gray-700 p-2 sm:p-3 flex justify-between items-center sticky top-0 z-50">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Calendar size={18} className="text-white"/>
                    </div>
                    <h1 className="hidden sm:block text-xl font-bold text-white">Venue Booking</h1>
                </div>

                {view === 'timeline' && (
                    <div className="flex-grow flex justify-center items-center relative mx-2">
                        <div className="flex items-center gap-1 sm:gap-2">
                            <button onClick={() => handleDateChange(-1)} className="p-2 rounded-md hover:bg-gray-700"><ChevronLeft size={20}/></button>
                            <button onClick={() => setShowCalendar(c => !c)} className="text-base sm:text-lg font-semibold hover:bg-gray-700 px-2 sm:px-3 py-1 rounded-md text-center">
                                <span className="sm:hidden">{shortDate}</span>
                                <span className="hidden sm:inline">{longDate}</span>
                            </button>
                            <button onClick={() => handleDateChange(1)} className="p-2 rounded-md hover:bg-gray-700"><ChevronRight size={20}/></button>
                            {showCalendar && <CalendarPopup selectedDate={selectedDate} setSelectedDate={setSelectedDate} onClose={() => setShowCalendar(false)} />}
                        </div>
                    </div>
                )}

                <nav className="flex items-center gap-2 sm:gap-4">
                     {view === 'timeline' && (
                         <>
                             <button onClick={() => setSelectedDate(new Date())} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg items-center gap-1.5 text-sm font-semibold hidden sm:flex">
                                 Today
                             </button>
                             <button
                                 onClick={() => handleOpenBookingModal(null, selectedDate)}
                                 className="bg-blue-600 hover:bg-blue-700 text-white p-2 sm:px-3 sm:py-2 rounded-lg flex items-center gap-1.5 text-sm font-semibold"
                             >
                                 <Plus size={16} /> <span className="hidden sm:inline">New</span>
                             </button>
                         </>
                     )}
                    <div className="flex items-center gap-2 p-1 bg-gray-800 rounded-lg">
                        <button
                            onClick={() => setView('timeline')}
                            className={`p-1.5 rounded-md ${view === 'timeline' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}
                            aria-label="Timeline View"
                        >
                            <Calendar size={20} />
                        </button>
                        <button
                            onClick={() => setView('settings')}
                            className={`p-1.5 rounded-md ${view === 'settings' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}
                            aria-label="Settings View"
                        >
                            <Settings size={20} />
                        </button>
                    </div>
                </nav>
            </header>

            <main className="flex-grow flex flex-col">
                {loading && <div className="p-8 text-center">Loading data...</div>}
                {error && <div className="p-8 text-center text-red-400">{error}</div>}
                
                {!loading && !error && (
                    <>
                        {view === 'timeline' && (
                            <TimelineView
                                db={db}
                                appId={appId}
                                activities={activities}
                                resources={resources}
                                bookings={bookings}
                                addOns={addOns}
                                resourceLinks={resourceLinks}
                                areas={areas}
                                scheduleOverrides={scheduleOverrides}
                                closures={closures}
                                onNewBooking={handleOpenBookingModal}
                                selectedDate={selectedDate}
                            />
                        )}
                        {view === 'settings' && (
                            <SettingsView
                                db={db}
                                appId={appId}
                                activities={activities}
                                resources={resources}
                                addOns={addOns}
                                resourceLinks={resourceLinks}
                                areas={areas}
                                closures={closures}
                            />
                        )}
                    </>
                )}
            </main>

            {isModalOpen && (
                <BookingModal
                    isOpen={isModalOpen}
                    onClose={handleCloseModal}
                    db={db}
                    appId={appId}
                    booking={editingBooking}
                    initialData={modalInitialData}
                    activities={activities}
                    resources={resources}
                    customers={customers}
                    addOns={addOns}
                    resourceLinks={resourceLinks}
                    bookings={bookings}
                    selectedDate={selectedDate}
                    areas={areas}
                    closures={closures}
                />
            )}
        </div>
    );
}

// --- Editable Slot Component ---
function EditableSlot({ slot, resource, onNewBooking, onUpdateTimeSlot, getBookingItemPosition, availableTimeOptions }) {
    const [isEditing, setIsEditing] = useState(false);
    const [newTime, setNewTime] = useState(slot.startTime.toTimeString().substring(0, 5));
    const popoverRef = useRef(null);

    const { left, width } = getBookingItemPosition(slot);

    const handleSave = (e) => {
        e.stopPropagation();
        onUpdateTimeSlot(resource.id, slot.startTime, newTime);
        setIsEditing(false);
    };

    useEffect(() => {
        function handleClickOutside(event) {
            if (popoverRef.current && !popoverRef.current.contains(event.target)) {
                setIsEditing(false);
            }
        }
        if (isEditing) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isEditing, popoverRef]);

    return (
        <div
            className="absolute top-1 bottom-1 flex items-center justify-center p-1 rounded-md z-5 cursor-pointer bg-gray-700/30 hover:bg-blue-500/20 border-2 border-dashed border-gray-600 hover:border-blue-400 group"
            style={{ left, width }}
            onClick={() => onNewBooking(null, slot.startTime, resource.id)}
        >
            <div className="text-center">
                <p className="text-xs font-semibold text-gray-300">Available</p>
                <p className="text-xs text-gray-500">{slot.startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
            </div>
            <button
                className="absolute top-1 right-1 p-1 rounded-full bg-gray-800/50 opacity-0 group-hover:opacity-100 hover:bg-gray-700"
                onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                }}
            >
                <Settings size={12} />
            </button>

            {isEditing && (
                <div
                    ref={popoverRef}
                    className="absolute top-0 left-0 w-full h-full bg-gray-800 z-10 rounded-md flex flex-col items-center justify-center p-2 gap-2 shadow-lg border border-gray-600"
                    onClick={(e) => e.stopPropagation()}
                >
                    <select
                        value={newTime}
                        onChange={(e) => setNewTime(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg p-1 text-xs text-white"
                    >
                        {availableTimeOptions.map(time => (
                            <option key={time} value={time}>{time}</option>
                        ))}
                    </select>
                    <button
                        onClick={handleSave}
                        className="w-full text-xs bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded-md text-white font-semibold"
                    >
                        Save
                    </button>
                </div>
            )}
        </div>
    );
}


// --- Fixed Time Slot Component ---
function FixedTimeSlots({ resource, activity, areas, selectedDate, onNewBooking, getBookingItemPosition, filteredBookings, unavailableSlots, onUpdateTimeSlot, scheduleOverrides }) {
    const slots = useMemo(() => {
        const dayOfWeek = DAYS_OF_WEEK[selectedDate.getDay()];
        const override = scheduleOverrides.find(o => 
            o.resourceId === resource.id &&
            o.date.toDateString() === selectedDate.toDateString()
        );

        let fixedTimeSlotsForDay;

        if (override) {
            fixedTimeSlotsForDay = override.fixedTimeSlots;
        } else {
            const area = areas.find(a => a.id === activity.areaId);
            if (!area) return [];
            const daySchedule = area.schedule?.find(s => s.day === dayOfWeek);
            if (!daySchedule || !daySchedule.isOpen) return [];
            fixedTimeSlotsForDay = daySchedule.fixedTimeSlots;
        }

        if (!fixedTimeSlotsForDay) return [];

        return fixedTimeSlotsForDay.map(time => {
            const [hour, minute] = time.split(':').map(Number);
            const startTime = new Date(selectedDate);
            startTime.setHours(hour, minute, 0, 0);
            
            const duration = 60; 
            const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

            const isBooked = filteredBookings.some(b => 
                b.items.some(item => {
                    const itemEnd = new Date(item.startTime.getTime() + item.duration * 60 * 1000);
                    return item.resourceIds.includes(resource.id) && item.startTime < endTime && itemEnd > startTime;
                })
            );

            const isUnavailable = unavailableSlots.some(slot => {
                const slotEnd = new Date(slot.startTime.getTime() + slot.duration * 60 * 1000);
                return slot.resourceId === resource.id && slot.startTime < endTime && slotEnd > startTime;
            });
            
            if (isBooked || isUnavailable) {
                return null;
            }

            return { startTime, duration };
        }).filter(Boolean);

    }, [resource.id, activity.areaId, areas, selectedDate, filteredBookings, unavailableSlots, scheduleOverrides]);
    
    const availableTimeOptions = useMemo(() => {
        const options = new Set();
        timeSlots.slice(0, -1).forEach(time => {
            const [hour, minute] = time.split(':').map(Number);
            const checkTime = new Date(selectedDate);
            checkTime.setHours(hour, minute, 0, 0);
            const checkTimeEnd = new Date(checkTime.getTime() + 60 * 60 * 1000);

            const isBooked = filteredBookings.some(b => 
                b.items.some(item => {
                    const itemEnd = new Date(item.startTime.getTime() + item.duration * 60 * 1000);
                    return item.resourceIds.includes(resource.id) && item.startTime < checkTimeEnd && itemEnd > checkTime;
                })
            );

            if (!isBooked) {
                options.add(time);
            }
        });
        return Array.from(options);
    }, [filteredBookings, selectedDate, resource.id]);

    return (
        <>
            {timeSlots.slice(0, -1).map((time, i) => (
                <div key={i} className={`w-16 h-full flex-shrink-0 border-r ${i % 4 === 3 ? 'border-gray-600' : 'border-gray-700'}`}></div>
            ))}
            {slots.map((slot, index) => (
                <EditableSlot 
                    key={index}
                    slot={slot}
                    resource={resource}
                    onNewBooking={onNewBooking}
                    onUpdateTimeSlot={onUpdateTimeSlot}
                    getBookingItemPosition={getBookingItemPosition}
                    availableTimeOptions={availableTimeOptions}
                />
            ))}
        </>
    );
}

// --- Payment Status Icon (Updated) ---
function PaymentStatusIcon({ booking, activities, addOns }) {
    const [status, setStatus] = useState('unpaid'); // unpaid, partial, paid
    const [tooltipVisible, setTooltipVisible] = useState(false);

    const { totalPrice, totalPaid, balance } = useMemo(() => {
        const price = calculateBookingPrice(booking, activities, addOns);
        const paid = (booking.payments || []).filter(p => p.status !== 'Refunded').reduce((acc, p) => acc + p.amount, 0);
        return { totalPrice: price, totalPaid: paid, balance: price - paid };
    }, [booking, activities, addOns]);

    useEffect(() => {
        if (totalPrice > 0) {
            if (totalPaid >= totalPrice) {
                setStatus('paid');
            } else if (totalPaid > 0) {
                setStatus('partial');
            } else {
                setStatus('unpaid');
            }
        } else {
            setStatus('paid'); // If total is 0, consider it paid
        }
    }, [totalPrice, totalPaid]);

    const colorClasses = {
        unpaid: 'bg-red-500 text-white',
        partial: 'bg-orange-500 text-white',
        paid: 'bg-green-500 text-white',
    };

    return (
        <div className="relative" onMouseEnter={() => setTooltipVisible(true)} onMouseLeave={() => setTooltipVisible(false)}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${colorClasses[status]}`}>
                <DollarSign size={12} />
            </div>
            {tooltipVisible && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-lg p-2 text-xs text-white z-20">
                    <p className="font-bold mb-1">Payment Status</p>
                    <div className="flex justify-between"><span>Total:</span><span>${totalPrice.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Paid:</span><span>${totalPaid.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold border-t border-gray-600 mt-1 pt-1"><span>Balance:</span><span>${balance.toFixed(2)}</span></div>
                </div>
            )}
        </div>
    );
}


// --- Timeline View Component (Updated) ---
function TimelineView({ db, appId, activities, resources, bookings, addOns, resourceLinks, areas, scheduleOverrides, closures, onNewBooking, selectedDate }) {
    const timelineBodyRef = useRef(null);
    const leftColumnRef = useRef(null);
    const timeHeaderRef = useRef(null);
    const [nowLinePos, setNowLinePos] = useState(null);

    const isClosed = useMemo(() => {
        return closures.some(c => c.date.toDateString() === selectedDate.toDateString());
    }, [closures, selectedDate]);

    useEffect(() => {
        const calculateNowLine = () => {
            const now = new Date();
            const startOfDay = new Date(now);
            startOfDay.setHours(8, 0, 0, 0);
            const minutesFromStart = (now.getTime() - startOfDay.getTime()) / 1000 / 60;
            if (minutesFromStart > 0 && minutesFromStart < 15 * 60) {
                setNowLinePos(`calc(${(minutesFromStart / 15)} * 4rem)`);
            } else {
                setNowLinePos(null);
            }
        };

        calculateNowLine();
        const timer = setInterval(calculateNowLine, 60000);
        return () => clearInterval(timer);
    }, [selectedDate]);


    useEffect(() => {
        const handleScroll = () => {
            if (leftColumnRef.current && timelineBodyRef.current) {
                leftColumnRef.current.scrollTop = timelineBodyRef.current.scrollTop;
            }
            if (timeHeaderRef.current && timelineBodyRef.current) {
                timeHeaderRef.current.scrollLeft = timelineBodyRef.current.scrollLeft;
            }
        };

        const timelineBody = timelineBodyRef.current;
        if (timelineBody) {
            timelineBody.addEventListener('scroll', handleScroll);
        }
        return () => {
            if (timelineBody) {
                timelineBody.removeEventListener('scroll', handleScroll);
            }
        };
    }, []);

    const getBookingItemPosition = (item) => {
        const startHour = item.startTime.getHours();
        const startMinute = item.startTime.getMinutes();
        const totalStartMinutes = (startHour - 8) * 60 + startMinute;
        
        const left = `calc(${(totalStartMinutes / 15)} * 4rem)`;
        const width = `calc(${(item.duration / 15)} * 4rem - 2px)`;

        return { left, width };
    };
    
    const handleCycleStatus = async (booking) => {
        const currentStatusIndex = BOOKING_STATUSES.indexOf(booking.status);
        const nextStatusIndex = (currentStatusIndex + 1) % BOOKING_STATUSES.length;
        const newStatus = BOOKING_STATUSES[nextStatusIndex];

        const bookingRef = doc(db, `artifacts/${appId}/public/data/bookings`, booking.id);
        try {
            await updateDoc(bookingRef, { status: newStatus });
        } catch (error) {
            console.error("Error updating status:", error);
        }
    };

    const handleUpdateTimeSlot = async (resourceId, oldStartTime, newTimeValue) => {
        if (!db) return;
        
        const normalizedDate = new Date(selectedDate);
        normalizedDate.setHours(0,0,0,0);

        const [hour, minute] = newTimeValue.split(':').map(Number);
        const newStartTime = new Date(oldStartTime);
        newStartTime.setHours(hour, minute);

        const resource = resources.find(r => r.id === resourceId);
        const activity = activities.find(a => a.id === resource.activityId);
        const area = areas.find(a => a.id === activity.areaId);
        const dayOfWeek = DAYS_OF_WEEK[oldStartTime.getDay()];
        const oldTimeStr = oldStartTime.toTimeString().substring(0, 5);

        if (!area) return;

        const overrideDoc = scheduleOverrides.find(o => 
            o.resourceId === resourceId &&
            o.date.toDateString() === selectedDate.toDateString()
        );

        if (overrideDoc) {
            const updatedSlots = overrideDoc.fixedTimeSlots.map(t => t === oldTimeStr ? newTimeValue : t).sort();
            const overrideRef = doc(db, `artifacts/${appId}/public/data/scheduleOverrides`, overrideDoc.id);
            await updateDoc(overrideRef, { fixedTimeSlots: updatedSlots });
        } else {
            const daySchedule = area.schedule?.find(s => s.day === dayOfWeek);
            const baseSlots = daySchedule?.fixedTimeSlots || [];
            const newSlots = baseSlots.map(t => t === oldTimeStr ? newTimeValue : t).sort();
            
            const overridesCollectionRef = collection(db, `artifacts/${appId}/public/data/scheduleOverrides`);
            await addDoc(overridesCollectionRef, {
                resourceId: resourceId,
                areaId: area.id,
                date: Timestamp.fromDate(normalizedDate),
                fixedTimeSlots: newSlots
            });
        }

        const bookingToUpdate = bookings.find(b =>
            b.items.some(item =>
                item.resourceIds.includes(resourceId) &&
                item.startTime.getTime() === oldStartTime.getTime()
            )
        );

        if (bookingToUpdate) {
            const updatedItems = bookingToUpdate.items.map(item => {
                let newStartTimeForThisItem = item.startTime;
                if (item.resourceIds.includes(resourceId) && item.startTime.getTime() === oldStartTime.getTime()) {
                    newStartTimeForThisItem = newStartTime;
                }
                return {
                    ...item,
                    startTime: Timestamp.fromDate(newStartTimeForThisItem)
                };
            });
            
            const bookingRef = doc(db, `artifacts/${appId}/public/data/bookings`, bookingToUpdate.id);
            await updateDoc(bookingRef, { items: updatedItems });
        }
    };
    
    const headerHeight = `h-[${ROW_HEIGHT_REM}rem]`;
    const rowHeightClass = `h-10`;

    const filteredBookings = useMemo(() => {
        return bookings.filter(booking => 
            booking.items.some(item => 
                item.startTime.getFullYear() === selectedDate.getFullYear() &&
                item.startTime.getMonth() === selectedDate.getMonth() &&
                item.startTime.getDate() === selectedDate.getDate()
            )
        );
    }, [bookings, selectedDate]);

    const groupedResources = useMemo(() => activities.map(activity => ({
        ...activity,
        resources: resources.filter(r => r.activityId === activity.id)
    })).filter(activity => activity.resources.length > 0), [activities, resources]);

    const isToday = useMemo(() => {
        const today = new Date();
        return selectedDate.getFullYear() === today.getFullYear() &&
               selectedDate.getMonth() === today.getMonth() &&
               selectedDate.getDate() === today.getDate();
    }, [selectedDate]);

    const unavailableSlots = useMemo(() => {
        const slots = [];
        const addedSlots = new Set();
        const dayOfWeek = DAYS_OF_WEEK[selectedDate.getDay()];

        const timeIntervals = [];
        for (let hour = 8; hour < 23; hour++) {
            for (let minute = 0; minute < 60; minute += 15) {
                const intervalStart = new Date(selectedDate);
                intervalStart.setHours(hour, minute, 0, 0);
                const intervalEnd = new Date(intervalStart.getTime() + 15 * 60 * 1000);
                timeIntervals.push({ start: intervalStart, end: intervalEnd });
            }
        }

        timeIntervals.forEach(interval => {
            areas.forEach(area => {
                const daySchedule = area.schedule?.find(s => s.day === dayOfWeek);
                if (!daySchedule || !daySchedule.isOpen) return;

                let staffAvailable = 0;
                daySchedule.staffBlocks.forEach(block => {
                    const blockStart = new Date(selectedDate);
                    const [startH, startM] = block.start.split(':');
                    blockStart.setHours(startH, startM, 0, 0);

                    const blockEnd = new Date(selectedDate);
                    const [endH, endM] = block.end.split(':');
                    blockEnd.setHours(endH, endM, 0, 0);

                    if (interval.start >= blockStart && interval.end <= blockEnd) {
                        staffAvailable = block.count;
                    }
                });

                const activeStaffUnits = new Set();

                filteredBookings.forEach(booking => {
                    booking.items.forEach(item => {
                        const activity = activities.find(a => a.id === item.activityId);
                        if (activity && activity.areaId === area.id) {
                            const itemEnd = new Date(item.startTime.getTime() + item.duration * 60 * 1000);
                            if (item.startTime < interval.end && itemEnd > interval.start) {
                                item.resourceIds.forEach(resId => {
                                    const linkGroup = resourceLinks.find(g => g.resourceIds.includes(resId));
                                    activeStaffUnits.add(linkGroup ? linkGroup.id : resId);
                                });
                            }
                        }
                    });
                });
                
                const staffUsed = activeStaffUnits.size;

                if (staffUsed >= staffAvailable) {
                    const resourcesInArea = resources.filter(r => {
                        const activity = activities.find(a => a.id === r.activityId);
                        return activity && activity.areaId === area.id;
                    });
                    
                    resourcesInArea.forEach(resource => {
                        const linkGroupOfResource = resourceLinks.find(g => g.resourceIds.includes(resource.id));
                        const resourceStaffUnit = linkGroupOfResource ? linkGroupOfResource.id : resource.id;

                        if (!activeStaffUnits.has(resourceStaffUnit)) {
                             const slotIdentifier = `${interval.start.getTime()}-${resource.id}`;
                             if (!addedSlots.has(slotIdentifier)) {
                                 slots.push({ id: `unavailable-${slotIdentifier}`, resourceId: resource.id, startTime: interval.start, duration: 15 });
                                 addedSlots.add(slotIdentifier);
                             }
                        }
                    });
                }
            });
        });

        const consolidatedSlots = [];
        const sortedSlots = slots.sort((a, b) => a.resourceId.localeCompare(b.resourceId) || a.startTime - b.startTime);
        
        let currentSlot = null;
        sortedSlots.forEach(slot => {
            if (!currentSlot) {
                currentSlot = { ...slot };
            } else if (slot.resourceId === currentSlot.resourceId && slot.startTime.getTime() === currentSlot.startTime.getTime() + currentSlot.duration * 60000) {
                currentSlot.duration += 15;
            } else {
                consolidatedSlots.push(currentSlot);
                currentSlot = { ...slot };
            }
        });
        if (currentSlot) {
            consolidatedSlots.push(currentSlot);
        }

        return consolidatedSlots;
    }, [filteredBookings, resourceLinks, resources, activities, areas, selectedDate]);


    return (
        <div className="flex-grow h-[calc(100vh-113px)] flex overflow-hidden">
            <div className="w-[110px] sm:w-[140px] flex-shrink-0 z-20 bg-gray-800 border-r border-gray-700 flex flex-col">
                <div className={`flex-shrink-0 border-b border-gray-700 ${headerHeight}`}></div>
                <div ref={leftColumnRef} className="overflow-y-hidden">
                    {groupedResources.map(activity => (
                        <div key={activity.id}>
                            <div className="h-8 flex items-center px-2 sm:px-4 bg-gray-700 border-b border-t border-gray-600">
                                <h3 className="text-sm font-bold text-blue-400 truncate">{activity.name}</h3>
                            </div>
                            {activity.resources.map(resource => (
                                <div key={resource.id} className={`flex items-center px-2 sm:px-4 border-b border-gray-700 ${rowHeightClass}`}>
                                    <span className="text-gray-300 truncate">{resource.abbreviation || resource.name}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
            <div ref={timelineBodyRef} className="flex-grow overflow-auto">
                <div className="relative min-w-max">
                    <div ref={timeHeaderRef} className={`flex sticky top-0 z-10 bg-gray-800 border-b border-gray-600 ${headerHeight}`}>
                        {timeSlots.slice(0, -1).map(time => (
                            <div key={time} className={`w-16 flex-shrink-0 text-center text-xs text-gray-400 flex items-center justify-center border-r border-gray-700`}>
                                {time.endsWith(':00') ? <strong>{time}</strong> : <span className="text-gray-600">·</span>}
                            </div>
                        ))}
                    </div>

                    {isClosed && (
                        <div className="absolute inset-0 bg-red-900/30 z-20 flex items-center justify-center pointer-events-none">
                            <div className="text-center p-4 bg-gray-900/80 rounded-lg border border-red-500/50">
                                <Ban className="mx-auto text-red-400 mb-2" size={32} />
                                <h2 className="text-xl font-bold text-white">Venue Closed</h2>
                                <p className="text-gray-400">This day has been marked as closed.</p>
                            </div>
                        </div>
                    )}

                    {!isClosed && groupedResources.map(activity => (
                        <div key={activity.id}>
                            <div className="h-8 border-b border-gray-600"></div>
                            {activity.resources.map(resource => (
                                <div key={resource.id} className={`relative flex border-b border-gray-700 ${rowHeightClass}`}>
                                    {activity.type === 'Fixed Time' ? (
                                        <FixedTimeSlots
                                            resource={resource}
                                            activity={activity}
                                            areas={areas}
                                            selectedDate={selectedDate}
                                            onNewBooking={onNewBooking}
                                            getBookingItemPosition={getBookingItemPosition}
                                            filteredBookings={filteredBookings}
                                            unavailableSlots={unavailableSlots}
                                            onUpdateTimeSlot={handleUpdateTimeSlot}
                                            scheduleOverrides={scheduleOverrides}
                                        />
                                    ) : (
                                        timeSlots.slice(0, -1).map((time, i) => (
                                            <div
                                                key={i}
                                                className={`w-16 h-full flex-shrink-0 border-r ${i % 4 === 3 ? 'border-gray-600' : 'border-gray-700'} hover:bg-blue-500/10 cursor-pointer`}
                                                onClick={() => onNewBooking(null, new Date(selectedDate.setHours(parseInt(time.split(':')[0]), parseInt(time.split(':')[1]), 0, 0)), resource.id)}
                                            ></div>
                                        ))
                                    )}
                                    {filteredBookings.flatMap(booking => booking.items
                                        .filter(item => item.resourceIds.includes(resource.id))
                                        .map(item => {
                                            const { left, width } = getBookingItemPosition(item);
                                            const isPrimaryBlock = item.resourceIds[0] === resource.id;

                                            return (
                                                <div
                                                    key={`${booking.id}-${item.id}`}
                                                    onClick={(e) => { e.stopPropagation(); onNewBooking(booking); }}
                                                    className={`absolute top-1 bottom-1 flex items-center justify-between px-2 rounded-md border cursor-pointer hover:opacity-90 transition-opacity z-10 ${BOOKING_STATUS_COLORS[booking.status]}`}
                                                    style={{ left, width, minWidth: '4rem' }}
                                                >
                                                    {isPrimaryBlock && (
                                                        <>
                                                            <p className="font-bold text-xs truncate text-white flex-grow mr-2">{booking.customerName || 'Walk-In'}</p>
                                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                                <PaymentStatusIcon booking={booking} activities={activities} addOns={addOns} />
                                                                {booking.notes && <FileText size={12} className="text-gray-200" title={booking.notes} />}
                                                                {booking.selectedAddOns && booking.selectedAddOns.map(sa => {
                                                                    const addOn = addOns.find(a => a.id === sa.addOnId);
                                                                    return addOn ? (
                                                                        <div key={addOn.id} className="bg-black/25 p-0.5 rounded-sm flex items-center justify-center">
                                                                             <AddOnIcon name={addOn.iconName} size={12} className="text-gray-200" title={`${addOn.name} (x${sa.quantity})`} />
                                                                        </div>
                                                                    ) : null;
                                                                })}
                                                                <div className="flex items-center gap-1 text-xs text-gray-200 bg-black/20 px-1.5 py-0.5 rounded-md">
                                                                    <Users size={12} />
                                                                    <span>{booking.groupSize}</span>
                                                                </div>
                                                                <button onClick={(e) => { e.stopPropagation(); handleCycleStatus(booking); }} className="hover:bg-black/20 p-1 rounded-full">
                                                                    <MoreVertical size={14} />
                                                                </button>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                     {unavailableSlots.filter(slot => slot.resourceId === resource.id).map(slot => {
                                         const { left, width } = getBookingItemPosition(slot);
                                         return (
                                             <div key={slot.id} className="absolute top-1 bottom-1 bg-gray-700/50 rounded-md z-5" style={{ left, width }}>
                                                 <div className="h-full w-full bg-stripes"></div>
                                             </div>
                                         )
                                     })}
                                </div>
                            ))}
                        </div>
                    ))}
                    {isToday && nowLinePos && (
                        <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none" style={{ left: nowLinePos }}>
                            <div className="absolute -top-1 -ml-1 w-2 h-2 bg-red-500 rounded-full"></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}


// --- Settings View Component ---
function SettingsView({ db, appId, activities, resources, addOns, resourceLinks, areas, closures }) {
    const [currentTab, setCurrentTab] = useState('activities');

    return (
        <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-white">Settings</h1>
                <p className="text-gray-400 mt-1">Manage activities and resources for your venue.</p>
            </div>
            <div className="flex border-b border-gray-700 mb-6 flex-wrap">
                <button onClick={() => setCurrentTab('activities')} className={`px-4 py-2 text-sm font-medium ${currentTab === 'activities' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}>
                    Activities
                </button>
                <button onClick={() => setCurrentTab('resources')} className={`px-4 py-2 text-sm font-medium ${currentTab === 'resources' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}>
                    Resources
                </button>
                 <button onClick={() => setCurrentTab('addOns')} className={`px-4 py-2 text-sm font-medium ${currentTab === 'addOns' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}>
                    Add-Ons
                </button>
                <button onClick={() => setCurrentTab('linking')} className={`px-4 py-2 text-sm font-medium ${currentTab === 'linking' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}>
                    Linking
                </button>
                <button onClick={() => setCurrentTab('schedule')} className={`px-4 py-2 text-sm font-medium ${currentTab === 'schedule' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}>
                    Schedule
                </button>
                 <button onClick={() => setCurrentTab('closures')} className={`px-4 py-2 text-sm font-medium ${currentTab === 'closures' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}>
                    Closures
                </button>
            </div>
            <div>
                {currentTab === 'activities' && <ActivityManager db={db} appId={appId} activities={activities} areas={areas} />}
                {currentTab === 'resources' && <ResourceManager db={db} appId={appId} resources={resources} activities={activities} />}
                {currentTab === 'addOns' && <AddOnManager db={db} appId={appId} addOns={addOns} />}
                {currentTab === 'linking' && <ResourceLinkManager db={db} appId={appId} resources={resources} activities={activities} resourceLinks={resourceLinks} />}
                {currentTab === 'schedule' && <AreaManager db={db} appId={appId} areas={areas} />}
                {currentTab === 'closures' && <ClosureManager db={db} appId={appId} closures={closures} />}
            </div>
        </div>
    );
}

// --- Activity Manager Component (Updated for Deposits) ---
function ActivityManager({ db, appId, activities, areas }) {
    const [name, setName] = useState('');
    const [type, setType] = useState('Fixed Time');
    const [price, setPrice] = useState('');
    const [areaId, setAreaId] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [requireDeposit, setRequireDeposit] = useState(false);
    const [depositType, setDepositType] = useState('Percentage'); // 'Percentage' or 'Fixed'
    const [depositValue, setDepositValue] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name || !price || !areaId) return;
        const collectionRef = collection(db, `artifacts/${appId}/public/data/activities`);
        const data = { 
            name, 
            type, 
            price: Number(price), 
            areaId,
            requireDeposit,
            depositType: requireDeposit ? depositType : null,
            depositValue: requireDeposit ? Number(depositValue) : null,
        };

        if (editingId) {
            await setDoc(doc(collectionRef, editingId), data);
        } else {
            await addDoc(collectionRef, data);
        }
        resetForm();
    };

    const handleEdit = (activity) => {
        setEditingId(activity.id);
        setName(activity.name);
        setType(activity.type);
        setPrice(activity.price);
        setAreaId(activity.areaId || '');
        setRequireDeposit(activity.requireDeposit || false);
        setDepositType(activity.depositType || 'Percentage');
        setDepositValue(activity.depositValue || '');
    };

    const handleDelete = async (id) => {
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/activities`, id));
    };

    const resetForm = () => {
        setName('');
        setType('Fixed Time');
        setPrice('');
        setAreaId('');
        setEditingId(null);
        setRequireDeposit(false);
        setDepositType('Percentage');
        setDepositValue('');
    };

    return (
        <div className="grid md:grid-cols-2 gap-8">
            <div>
                <h3 className="text-xl font-semibold mb-4">{editingId ? 'Edit Activity' : 'Add New Activity'}</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <InputField label="Activity Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Bowling" Icon={Tag} required={true} />
                    <div>
                        <label className="text-sm font-medium text-gray-400 mb-1 block">Area</label>
                        <select value={areaId} onChange={(e) => setAreaId(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500" required>
                            <option value="" disabled>Select an area</option>
                            {areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-400 mb-1 block">Activity Type</label>
                        <select value={type} onChange={(e) => setType(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            <option>Fixed Time</option>
                            <option>Flexi Time</option>
                        </select>
                    </div>
                    <InputField label={type === 'Fixed Time' ? 'Price per Person' : 'Price per Person (per 15 min)'} type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g., 25" Icon={DollarSign} required={true}/>
                    
                    <div className="bg-gray-800 p-4 rounded-lg space-y-4 border border-gray-700">
                        <InputField label="Require Deposit at Booking" type="checkbox" checked={requireDeposit} onChange={(e) => setRequireDeposit(e.target.checked)} />
                        {requireDeposit && (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium text-gray-400 mb-1 block">Deposit Type</label>
                                    <select value={depositType} onChange={(e) => setDepositType(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white">
                                        <option value="Percentage">Percentage (%)</option>
                                        <option value="Fixed">Fixed Amount ($)</option>
                                    </select>
                                </div>
                                <InputField label="Deposit Value" type="number" value={depositValue} onChange={(e) => setDepositValue(e.target.value)} placeholder={depositType === 'Percentage' ? 'e.g., 50' : 'e.g., 100'} required={true} />
                            </div>
                        )}
                    </div>
                    
                    <div className="flex gap-2">
                        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg w-full">{editingId ? 'Update' : 'Save'}</button>
                        {editingId && <button type="button" onClick={resetForm} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg w-full">Cancel</button>}
                    </div>
                </form>
            </div>
            <div>
                <h3 className="text-xl font-semibold mb-4">Existing Activities</h3>
                <ul className="space-y-2">
                    {activities.map(act => (
                        <li key={act.id} className="bg-gray-800 p-3 rounded-lg flex justify-between items-center">
                            <div>
                                <p className="font-semibold">{act.name}</p>
                                <p className="text-xs text-gray-400">{act.type} - ${act.price}{act.type === 'Flexi Time' ? '/person/15min' : '/person'}</p>
                                {act.requireDeposit && <p className="text-xs text-blue-400">Deposit: {act.depositType === 'Percentage' ? `${act.depositValue}%` : `$${act.depositValue}`}</p>}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleEdit(act)} className="p-2 hover:bg-gray-700 rounded-md"><Settings size={16} /></button>
                                <button onClick={() => handleDelete(act.id)} className="p-2 hover:bg-gray-700 rounded-md"><Trash2 size={16} /></button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

// --- Resource Manager Component ---
function ResourceManager({ db, appId, resources, activities }) {
    const [name, setName] = useState('');
    const [abbreviation, setAbbreviation] = useState('');
    const [capacity, setCapacity] = useState('');
    const [activityId, setActivityId] = useState('');
    const [editingId, setEditingId] = useState(null);

    useEffect(() => {
        if (activities.length > 0 && !activityId) {
            setActivityId(activities[0].id);
        }
    }, [activities, activityId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name || !capacity || !activityId || !abbreviation) return;
        const collectionRef = collection(db, `artifacts/${appId}/public/data/resources`);
        const data = { name, abbreviation, capacity: Number(capacity), activityId };

        if (editingId) {
            await setDoc(doc(collectionRef, editingId), data);
        } else {
            await addDoc(collectionRef, data);
        }
        resetForm();
    };

    const handleEdit = (resource) => {
        setEditingId(resource.id);
        setName(resource.name);
        setAbbreviation(resource.abbreviation || '');
        setCapacity(resource.capacity);
        setActivityId(resource.activityId);
    };

    const handleDelete = async (id) => {
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/resources`, id));
    };

    const resetForm = () => {
        setName('');
        setAbbreviation('');
        setCapacity('');
        setActivityId(activities.length > 0 ? activities[0].id : '');
        setEditingId(null);
    };

    return (
        <div className="grid md:grid-cols-2 gap-8">
            <div>
                <h3 className="text-xl font-semibold mb-4">{editingId ? 'Edit Resource' : 'Add New Resource'}</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                           <InputField label="Resource Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Lane 1" Icon={GripVertical} required={true}/>
                        </div>
                        <InputField label="Abbreviation" value={abbreviation} onChange={(e) => setAbbreviation(e.target.value.toUpperCase())} placeholder="LANE1" Icon={CaseUpper} required={true} maxLength={4} />
                    </div>
                    <InputField label="Capacity" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g., 6" Icon={Users} required={true}/>
                    <div>
                        <label className="text-sm font-medium text-gray-400 mb-1 block">Assign to Activity</label>
                        <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500" required>
                             <option value="" disabled>Select an activity</option>
                            {activities.map(act => <option key={act.id} value={act.id}>{act.name}</option>)}
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg w-full">{editingId ? 'Update' : 'Save'}</button>
                        {editingId && <button type="button" onClick={resetForm} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg w-full">Cancel</button>}
                    </div>
                </form>
            </div>
            <div>
                <h3 className="text-xl font-semibold mb-4">Existing Resources</h3>
                <ul className="space-y-2">
                    {resources.map(res => (
                        <li key={res.id} className="bg-gray-800 p-3 rounded-lg flex justify-between items-center">
                            <div>
                                <p className="font-semibold">{res.name} ({res.abbreviation})</p>
                                <p className="text-xs text-gray-400">
                                    {activities.find(a => a.id === res.activityId)?.name || 'Unassigned'} - Capacity: {res.capacity}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleEdit(res)} className="p-2 hover:bg-gray-700 rounded-md"><Settings size={16} /></button>
                                <button onClick={() => handleDelete(res.id)} className="p-2 hover:bg-gray-700 rounded-md"><Trash2 size={16} /></button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

// --- AddOn Manager Component ---
function AddOnManager({ db, appId, addOns }) {
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    const [iconName, setIconName] = useState('Default');
    const [editingId, setEditingId] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name || !price) return;
        const collectionRef = collection(db, `artifacts/${appId}/public/data/addOns`);
        const data = { name, price: Number(price), iconName };

        if (editingId) {
            await setDoc(doc(collectionRef, editingId), data);
        } else {
            await addDoc(collectionRef, data);
        }
        resetForm();
    };

    const handleEdit = (addOn) => {
        setEditingId(addOn.id);
        setName(addOn.name);
        setPrice(addOn.price);
        setIconName(addOn.iconName || 'Default');
    };

    const handleDelete = async (id) => {
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/addOns`, id));
    };

    const resetForm = () => {
        setName('');
        setPrice('');
        setIconName('Default');
        setEditingId(null);
    };

    return (
        <div className="grid md:grid-cols-2 gap-8">
            <div>
                <h3 className="text-xl font-semibold mb-4">{editingId ? 'Edit Add-On' : 'Add New Add-On'}</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <InputField label="Add-On Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Drink Package" Icon={ShoppingCart} required={true} />
                    <InputField label="Price per Person" type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g., 15" Icon={DollarSign} required={true}/>
                    <div>
                        <label className="text-sm font-medium text-gray-400 mb-1 block">Icon</label>
                        <select value={iconName} onChange={(e) => setIconName(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            {Object.keys(ADD_ON_ICONS).map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg w-full">{editingId ? 'Update' : 'Save'}</button>
                        {editingId && <button type="button" onClick={resetForm} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg w-full">Cancel</button>}
                    </div>
                </form>
            </div>
            <div>
                <h3 className="text-xl font-semibold mb-4">Existing Add-Ons</h3>
                <ul className="space-y-2">
                    {addOns.map(addOn => (
                        <li key={addOn.id} className="bg-gray-800 p-3 rounded-lg flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <AddOnIcon name={addOn.iconName} size={18} />
                                <div>
                                    <p className="font-semibold">{addOn.name}</p>
                                    <p className="text-xs text-gray-400">${addOn.price}/person</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleEdit(addOn)} className="p-2 hover:bg-gray-700 rounded-md"><Settings size={16} /></button>
                                <button onClick={() => handleDelete(addOn.id)} className="p-2 hover:bg-gray-700 rounded-md"><Trash2 size={16} /></button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

// --- Resource Link Manager Component ---
function ResourceLinkManager({ db, appId, resources, activities, resourceLinks }) {
    const [selectedResources, setSelectedResources] = useState([]);

    const handleToggleResource = (id) => {
        setSelectedResources(prev => 
            prev.includes(id) ? prev.filter(resId => resId !== id) : [...prev, id]
        );
    };

    const handleSaveGroup = async () => {
        if (selectedResources.length < 2) {
            // Replace alert with a more user-friendly notification if possible
            console.warn("Please select at least two resources to link.");
            return;
        }
        const collectionRef = collection(db, `artifacts/${appId}/public/data/resourceLinks`);
        await addDoc(collectionRef, { resourceIds: selectedResources });
        setSelectedResources([]);
    };

    const handleDeleteGroup = async (id) => {
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/resourceLinks`, id));
    };

    const groupedResources = useMemo(() => activities.map(activity => ({
        ...activity,
        resources: resources.filter(r => r.activityId === activity.id)
    })).filter(activity => activity.resources.length > 0), [activities, resources]);

    return (
        <div className="grid md:grid-cols-2 gap-8">
            <div>
                <h3 className="text-xl font-semibold mb-4">Create New Link Group</h3>
                <div className="bg-gray-800 p-4 rounded-lg">
                    <p className="text-sm text-gray-400 mb-4">Select two or more resources that conflict with each other. If one is booked, the others will be blocked for the same time slot.</p>
                    <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
                        {groupedResources.map(activity => (
                            <div key={activity.id}>
                                <p className="font-bold text-blue-400 text-sm mb-2">{activity.name}</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {activity.resources.map(resource => (
                                        <button
                                            key={resource.id}
                                            onClick={() => handleToggleResource(resource.id)}
                                            className={`p-2 text-sm rounded-lg border-2 text-center ${selectedResources.includes(resource.id) ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 hover:border-gray-500'}`}
                                        >
                                            {resource.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <button onClick={handleSaveGroup} className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">
                        Save Link Group
                    </button>
                </div>
            </div>
            <div>
                <h3 className="text-xl font-semibold mb-4">Existing Link Groups</h3>
                <ul className="space-y-2">
                    {resourceLinks.map(link => (
                        <li key={link.id} className="bg-gray-800 p-3 rounded-lg flex justify-between items-center">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Link2 size={16} className="text-gray-400"/>
                                {link.resourceIds.map(resId => {
                                    const resource = resources.find(r => r.id === resId);
                                    return <span key={resId} className="bg-gray-700 text-xs px-2 py-1 rounded-md">{resource?.name || '...'}</span>
                                })}
                            </div>
                            <button onClick={() => handleDeleteGroup(link.id)} className="p-2 hover:bg-gray-700 rounded-md"><Trash2 size={16} /></button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

// --- Area Manager Component ---
function AreaManager({ db, appId, areas }) {
    const defaultSchedule = DAYS_OF_WEEK.map(day => ({ 
        day, 
        isOpen: true, 
        staffBlocks: [{id: Date.now() + Math.random(), start: '09:00', end: '22:00', count: 1}],
        fixedTimeSlots: []
    }));

    const [name, setName] = useState('');
    const [schedule, setSchedule] = useState(defaultSchedule);
    const [editingId, setEditingId] = useState(null);
    const [newTimeInputs, setNewTimeInputs] = useState(
        DAYS_OF_WEEK.reduce((acc, day) => ({ ...acc, [day]: '' }), {})
    );

    const handleNewTimeInputChange = (day, value) => {
        setNewTimeInputs(prev => ({ ...prev, [day]: value }));
    };
    
    const addFixedTimeSlot = (day) => {
        const time = newTimeInputs[day];
        if (time) {
            setSchedule(prev => prev.map(item => {
                if (item.day === day && !item.fixedTimeSlots.includes(time)) {
                    const newSlots = [...item.fixedTimeSlots, time].sort();
                    return { ...item, fixedTimeSlots: newSlots };
                }
                return item;
            }));
            handleNewTimeInputChange(day, ''); 
        }
    };

    const removeFixedTimeSlot = (day, timeToRemove) => {
        setSchedule(prev => prev.map(item => {
            if (item.day === day) {
                const newSlots = item.fixedTimeSlots.filter(t => t !== timeToRemove);
                return { ...item, fixedTimeSlots: newSlots };
            }
            return item;
        }));
    };

    const handleScheduleChange = (day, field, value) => {
        setSchedule(prev => prev.map(item => item.day === day ? { ...item, [field]: value } : item));
    };

    const handleBlockChange = (day, id, field, value) => {
        setSchedule(prev => prev.map(item => {
            if (item.day === day) {
                const newBlocks = item.staffBlocks.map(b => b.id === id ? {...b, [field]: value} : b);
                return { ...item, staffBlocks: newBlocks };
            }
            return item;
        }))
    };
    
    const addBlock = (day) => {
        setSchedule(prev => prev.map(item => {
            if (item.day === day) {
                return { ...item, staffBlocks: [...item.staffBlocks, {id: Date.now(), start: '17:00', end: '22:00', count: 1}] };
            }
            return item;
        }))
    };

    const removeBlock = (day, id) => {
       setSchedule(prev => prev.map(item => {
            if (item.day === day) {
                const newBlocks = item.staffBlocks.filter(b => b.id !== id);
                return { ...item, staffBlocks: newBlocks };
            }
            return item;
        }))
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name) return;
        const collectionRef = collection(db, `artifacts/${appId}/public/data/areas`);
        const data = { name, schedule };

        if (editingId) {
            await setDoc(doc(collectionRef, editingId), data);
        } else {
            await addDoc(collectionRef, data);
        }
        resetForm();
    };
    
    const handleEdit = (area) => {
        setEditingId(area.id);
        setName(area.name);
        
        const defaultDaySchedule = { isOpen: true, staffBlocks: [{id: Date.now() + Math.random(), start: '09:00', end: '22:00', count: 1}], fixedTimeSlots: [] };
        const areaSchedule = DAYS_OF_WEEK.map(day => {
            const existingDay = area.schedule?.find(s => s.day === day);
            return { 
                day,
                isOpen: existingDay?.isOpen ?? true,
                staffBlocks: existingDay?.staffBlocks?.length > 0 ? existingDay.staffBlocks : defaultDaySchedule.staffBlocks,
                fixedTimeSlots: existingDay?.fixedTimeSlots ? [...new Set(existingDay.fixedTimeSlots)].sort() : []
            };
        });
        setSchedule(areaSchedule);
    };

    const handleDelete = async (id) => {
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/areas`, id));
    };

    const resetForm = () => {
        setName('');
        setSchedule(defaultSchedule);
        setEditingId(null);
    };

    const TimeInput = ({ value, onChange }) => {
        const inputRef = useRef(null);
        const handleClick = () => {
            if (inputRef.current) {
                try {
                    inputRef.current.showPicker();
                } catch (e) {
                    // For browsers that don't support showPicker()
                    console.log("showPicker() is not supported by this browser.");
                }
            }
        };
        return (
            <div className="relative w-full" onClick={handleClick}>
                <input
                    ref={inputRef}
                    type="time"
                    value={value}
                    onChange={onChange}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none text-center"
                    required
                />
            </div>
        );
    };

    return (
        <div className="grid md:grid-cols-2 gap-8">
            <div>
                <h3 className="text-xl font-semibold mb-4">{editingId ? 'Edit Area' : 'Add New Area'}</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <InputField label="Area Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Main Floor" Icon={MapPin} required={true} />
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                        {schedule.map(({ day, isOpen, staffBlocks, fixedTimeSlots }) => (
                            <div key={day} className="bg-gray-800 p-3 rounded-lg">
                                <label className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-2">
                                    <input type="checkbox" checked={isOpen} onChange={(e) => handleScheduleChange(day, 'isOpen', e.target.checked)} className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-600"/>
                                    {day}
                                </label>
                                {isOpen && (
                                    <div className="pl-6 space-y-4">
                                        <div>
                                            <label className="text-xs font-semibold text-gray-400">Staff Availability</label>
                                            <div className="space-y-2 mt-1">
                                                {staffBlocks.map((block, index) => (
                                                    <div key={block.id || index} className="grid grid-cols-12 gap-2 items-end">
                                                        <div className="col-span-5"><TimeInput value={block.start} onChange={(e) => handleBlockChange(day, block.id, 'start', e.target.value)} /></div>
                                                        <div className="col-span-5"><TimeInput value={block.end} onChange={(e) => handleBlockChange(day, block.id, 'end', e.target.value)} /></div>
                                                        <div className="col-span-1">
                                                            <select
                                                                value={block.count}
                                                                onChange={(e) => handleBlockChange(day, block.id, 'count', Number(e.target.value))}
                                                                className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                            >
                                                                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                                                            </select>
                                                        </div>
                                                        <button type="button" onClick={() => removeBlock(day, block.id)} className="col-span-1 justify-self-center p-2 text-red-400 hover:bg-gray-700 rounded-md mb-1"><Trash2 size={16}/></button>
                                                    </div>
                                                ))}
                                                <button type="button" onClick={() => addBlock(day)} className="text-xs text-blue-400 hover:underline">+ Add Staff Block</button>
                                            </div>
                                        </div>
                                        
                                        <div>
                                            <label className="text-xs font-semibold text-gray-400">Fixed Activity Start Times</label>
                                            <div className="flex flex-wrap gap-2 mt-1">
                                                {fixedTimeSlots.map(time => (
                                                    <div key={time} className="bg-gray-700 px-2 py-1 rounded-md text-sm flex items-center gap-1">
                                                        <span>{time}</span>
                                                        <button type="button" onClick={() => removeFixedTimeSlot(day, time)} className="text-gray-400 hover:text-white"><X size={14} /></button>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="flex gap-2 mt-2">
                                                <input 
                                                    type="time" 
                                                    step="900"
                                                    value={newTimeInputs[day]}
                                                    onChange={(e) => handleNewTimeInputChange(day, e.target.value)}
                                                    className="w-24 bg-gray-900 border border-gray-600 rounded-lg p-1 text-xs"
                                                />
                                                <button type="button" onClick={() => addFixedTimeSlot(day)} className="text-xs bg-blue-600 hover:bg-blue-700 px-2 rounded-md">Add</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg w-full">{editingId ? 'Update' : 'Save'}</button>
                        {editingId && <button type="button" onClick={resetForm} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg w-full">Cancel</button>}
                    </div>
                </form>
            </div>
            <div>
                <h3 className="text-xl font-semibold mb-4">Existing Areas</h3>
                <ul className="space-y-2">
                    {areas.map(area => (
                        <li key={area.id} className="bg-gray-800 p-3 rounded-lg flex justify-between items-center">
                            <div>
                                <p className="font-semibold">{area.name}</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleEdit(area)} className="p-2 hover:bg-gray-700 rounded-md"><Settings size={16} /></button>
                                <button onClick={() => handleDelete(area.id)} className="p-2 hover:bg-gray-700 rounded-md"><Trash2 size={16} /></button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

// --- Closure Manager Component ---
function ClosureManager({ db, appId, closures }) {
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');

  const handleAddClosure = async (e) => {
    e.preventDefault();
    if (!newDate) return;
    const date = new Date(newDate);
    // Adjust for timezone to store as a pure date
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    
    const closureData = {
      date: Timestamp.fromDate(date),
      reason: reason.trim()
    };
    await addDoc(collection(db, `artifacts/${appId}/public/data/closures`), closureData);
    setNewDate('');
    setReason('');
  };

  const handleDeleteClosure = async (id) => {
    await deleteDoc(doc(db, `artifacts/${appId}/public/data/closures`, id));
  };

  const sortedClosures = useMemo(() => 
    [...closures].sort((a, b) => a.date - b.date), 
  [closures]);

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div>
        <h3 className="text-xl font-semibold mb-4">Add Venue Closure</h3>
        <form onSubmit={handleAddClosure} className="space-y-4 bg-gray-800 p-4 rounded-lg">
          <InputField 
            label="Date" 
            type="date" 
            value={newDate} 
            onChange={(e) => setNewDate(e.target.value)} 
            required={true} 
          />
          <InputField 
            label="Reason (Optional)" 
            value={reason} 
            onChange={(e) => setReason(e.target.value)} 
            placeholder="e.g., Public Holiday" 
          />
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg w-full">
            Add Closure
          </button>
        </form>
      </div>
      <div>
        <h3 className="text-xl font-semibold mb-4">Scheduled Closures</h3>
        <ul className="space-y-2">
          {sortedClosures.map(c => (
            <li key={c.id} className="bg-gray-800 p-3 rounded-lg flex justify-between items-center">
              <div>
                <p className="font-semibold">{c.date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                {c.reason && <p className="text-xs text-gray-400">{c.reason}</p>}
              </div>
              <button onClick={() => handleDeleteClosure(c.id)} className="p-2 hover:bg-gray-700 rounded-md text-red-400">
                <Trash2 size={16} />
              </button>
            </li>
          ))}
          {closures.length === 0 && (
            <p className="text-gray-500">No closure dates scheduled.</p>
          )}
        </ul>
      </div>
    </div>
  );
}


// --- Booking Modal Component (Updated with Payments) ---
function BookingModal({ isOpen, onClose, db, appId, booking, initialData, activities, resources, customers, addOns, resourceLinks, bookings, selectedDate, areas, closures }) {
    const [customerName, setCustomerName] = useState('');
    const [customerDetails, setCustomerDetails] = useState({ phone: '', email: '' });
    const [groupSize, setGroupSize] = useState(2);
    const [bookingItems, setBookingItems] = useState([]);
    const [notes, setNotes] = useState('');
    const [selectedAddOns, setSelectedAddOns] = useState([]);
    const [payments, setPayments] = useState([]);
    const [modalError, setModalError] = useState(null);

    const [customerSearch, setCustomerSearch] = useState('');
    const [customerSuggestions, setCustomerSuggestions] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);
    
    const resetModalState = useCallback(() => {
        const defaultStartTime = new Date(selectedDate);
        defaultStartTime.setHours(12, 0, 0, 0);
        setCustomerName('');
        setCustomerDetails({ phone: '', email: '' });
        setGroupSize(2);
        setBookingItems(initialData.items || [{ id: Date.now(), activityId: '', resourceIds: [], startTime: defaultStartTime, duration: 60 }]);
        setNotes('');
        setSelectedAddOns([]);
        setPayments([]);
        setCustomerSearch('');
        setCustomerSuggestions([]);
        setSelectedCustomerId(null);
        setModalError(null);
    }, [initialData, selectedDate]);

    useEffect(() => {
        if (isOpen) {
            if (booking) {
                const customer = customers.find(c => c.id === booking.customerId);
                setCustomerName(booking.customerName || '');
                setCustomerSearch(booking.customerName || '');
                setCustomerDetails({ phone: customer?.phone || '', email: customer?.email || '' });
                setSelectedCustomerId(booking.customerId);
                setGroupSize(booking.groupSize);
                setBookingItems(booking.items.map(item => ({...item, id: item.id || Date.now() + Math.random()})));
                setNotes(booking.notes || '');
                setSelectedAddOns(booking.selectedAddOns || []);
                setPayments(booking.payments || []);
            } else {
                 resetModalState();
            }
        }
    }, [booking, isOpen, customers, resetModalState]);

    // Clear error when user makes changes
    useEffect(() => {
        setModalError(null);
    }, [bookingItems, customerName, groupSize]);

    useEffect(() => {
        if (customerSearch.length > 1) {
            const lowercasedSearch = customerSearch.toLowerCase();
            const suggestions = customers.filter(c => 
                c.name.toLowerCase().includes(lowercasedSearch) ||
                (c.phone && c.phone.includes(customerSearch)) ||
                (c.email && c.email.toLowerCase().includes(lowercasedSearch))
            );
            setCustomerSuggestions(suggestions);
        } else {
            setCustomerSuggestions([]);
        }
    }, [customerSearch, customers]);

    useEffect(() => {
        setSelectedAddOns(prev => prev.map(addOn => ({...addOn, quantity: Number(groupSize)})))
    }, [groupSize]);


    const handleSelectCustomer = (customer) => {
        setCustomerName(customer.name);
        setCustomerSearch(customer.name);
        setCustomerDetails({ phone: customer.phone || '', email: customer.email || '' });
        setSelectedCustomerId(customer.id);
        setCustomerSuggestions([]);
    };

    const handleAddItem = () => {
        const lastItemTime = bookingItems.length > 0 ? bookingItems[bookingItems.length - 1].startTime : new Date(selectedDate);
        setBookingItems(prev => [...prev, { id: Date.now(), activityId: '', resourceIds: [], startTime: lastItemTime, duration: 60 }]);
    };

    const handleRemoveItem = (id) => {
        setBookingItems(prev => prev.filter(item => item.id !== id));
    };

    const handleItemChange = (id, field, value) => {
        setBookingItems(prev => prev.map(item => {
            if (item.id === id) {
                const updatedItem = { ...item, [field]: value };
                if (field === 'activityId') {
                    updatedItem.resourceIds = [];
                }
                return updatedItem;
            }
            return item;
        }));
    };

    const handleItemResourceToggle = (itemId, resourceId) => {
        setBookingItems(prev => prev.map(item => {
            if (item.id === itemId) {
                const newResourceIds = item.resourceIds.includes(resourceId)
                    ? item.resourceIds.filter(id => id !== resourceId)
                    : [...item.resourceIds, resourceId];
                return { ...item, resourceIds: newResourceIds };
            }
            return item;
        }));
    };
    
    const handleAddOnToggle = (addOnId) => {
        setSelectedAddOns(prev => {
            const existing = prev.find(a => a.addOnId === addOnId);
            if (existing) {
                return prev.filter(a => a.addOnId !== addOnId);
            } else {
                return [...prev, { addOnId, quantity: Number(groupSize) }];
            }
        });
    };

    const handleAddOnQuantityChange = (addOnId, quantity) => {
        setSelectedAddOns(prev => prev.map(a => a.addOnId === addOnId ? {...a, quantity: Number(quantity)} : a));
    };

    const handleSave = async () => {
        setModalError(null);
        if (bookingItems.some(item => !item.activityId || item.resourceIds.length === 0)) {
            setModalError("Please select an activity and at least one resource for each item.");
            return;
        }
        
        // --- CONFLICT VALIDATION ---
        const allOtherBookings = booking ? bookings.filter(b => b.id !== booking.id) : bookings;

        for (const itemToSave of bookingItems) {
            const itemStart = itemToSave.startTime;
            const itemEnd = new Date(itemStart.getTime() + itemToSave.duration * 60 * 1000);
            
            const isDayClosed = closures.some(c => c.date.toDateString() === itemStart.toDateString());
            if (isDayClosed) {
                setModalError(`Cannot create booking: The venue is closed on ${itemStart.toLocaleDateString()}.`);
                return;
            }

            const activity = activities.find(a => a.id === itemToSave.activityId);
            const area = areas.find(a => a.id === activity?.areaId);
            if (!area) {
                setModalError(`Configuration error: Activity "${activity?.name}" is not assigned to an area.`);
                return;
            }

            const dayOfWeek = DAYS_OF_WEEK[itemStart.getDay()];
            const daySchedule = area.schedule?.find(s => s.day === dayOfWeek);
            if (!daySchedule || !daySchedule.isOpen) {
                setModalError(`The venue is closed at the selected time.`);
                return;
            }

            let staffAvailable = 0;
            daySchedule.staffBlocks.forEach(block => {
                const blockStart = new Date(itemStart);
                const [startH, startM] = block.start.split(':');
                blockStart.setHours(startH, startM, 0, 0);

                const blockEnd = new Date(itemStart);
                const [endH, endM] = block.end.split(':');
                blockEnd.setHours(endH, endM, 0, 0);

                if (itemStart >= blockStart && itemEnd <= blockEnd) {
                    staffAvailable = block.count;
                }
            });

            if (staffAvailable === 0) {
                setModalError(`No staff are scheduled for the selected time slot.`);
                return;
            }

            for (const existingBooking of allOtherBookings) {
                for (const existingItem of existingBooking.items) {
                    const existingStart = existingItem.startTime;
                    const existingEnd = new Date(existingStart.getTime() + existingItem.duration * 60 * 1000);
                    if (itemStart < existingEnd && itemEnd > existingStart) {
                        const hasDirectClash = itemToSave.resourceIds.some(resId => existingItem.resourceIds.includes(resId));
                        if (hasDirectClash) {
                            const clashingResource = resources.find(r => itemToSave.resourceIds.includes(r.id) && existingItem.resourceIds.includes(r.id));
                            setModalError(`Booking Conflict: "${clashingResource?.name}" is already booked at this time.`);
                            return;
                        }
                    }
                }
            }
            
            const activeStaffUnits = new Set();
            
            allOtherBookings.forEach(b => {
                b.items.forEach(i => {
                    const iActivity = activities.find(a => a.id === i.activityId);
                    if (iActivity?.areaId !== area.id) return;

                    const iStart = i.startTime;
                    const iEnd = new Date(iStart.getTime() + i.duration * 60 * 1000);

                    if (itemStart < iEnd && itemEnd > iStart) {
                        i.resourceIds.forEach(resId => {
                            const linkGroup = resourceLinks.find(link => link.resourceIds.includes(resId));
                            activeStaffUnits.add(linkGroup ? linkGroup.id : resId);
                        });
                    }
                });
            });

            const newStaffUnits = new Set();
            itemToSave.resourceIds.forEach(resId => {
                const linkGroup = resourceLinks.find(link => link.resourceIds.includes(resId));
                newStaffUnits.add(linkGroup ? linkGroup.id : resId);
            });
            
            const staffRequired = activeStaffUnits.size + newStaffUnits.size;

            if (staffRequired > staffAvailable) {
                setModalError(`Booking Conflict: Not enough staff available. ${staffRequired} needed, but only ${staffAvailable} are scheduled.`);
                return;
            }
        }
        // --- END CONFLICT VALIDATION ---

        setIsSaving(true);

        const finalCustomerName = customerName.trim() || 'Walk-In';
        let customerId = selectedCustomerId;

        if (finalCustomerName !== 'Walk-In') {
            const customerData = { name: finalCustomerName, phone: customerDetails.phone, email: customerDetails.email };
            if (customerId) {
                await updateDoc(doc(db, `artifacts/${appId}/public/data/customers`, customerId), customerData);
            } else {
                const newCustomerRef = await addDoc(collection(db, `artifacts/${appId}/public/data/customers`), { ...customerData, createdAt: serverTimestamp() });
                customerId = newCustomerRef.id;
            }
        }

        const finalBookingItems = bookingItems.map(item => ({
            activityId: item.activityId,
            resourceIds: item.resourceIds,
            startTime: Timestamp.fromDate(item.startTime),
            duration: item.duration,
        }));

        const bookingData = {
            customerName: finalCustomerName,
            customerId,
            groupSize: Number(groupSize),
            status: booking ? booking.status : 'Booked',
            items: finalBookingItems,
            notes: notes.trim(),
            selectedAddOns: selectedAddOns,
            payments: payments.map(p => ({...p, date: Timestamp.fromDate(p.date)})),
        };

        try {
            if (booking) {
                await setDoc(doc(db, `artifacts/${appId}/public/data/bookings`, booking.id), bookingData);
            } else {
                await addDoc(collection(db, `artifacts/${appId}/public/data/bookings`), bookingData);
            }
            onClose();
        } catch (error) {
            console.error("Error saving booking:", error);
            setModalError("Failed to save booking. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleDelete = async () => {
        setIsSaving(true);
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/public/data/bookings`, booking.id));
            onClose();
        } catch (error) {
            console.error("Error deleting booking:", error);
            setModalError("Failed to delete booking.");
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
            <div className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <header className="p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white">{booking ? 'Edit Booking' : 'New Booking'}</h2>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-700"><X size={20} /></button>
                </header>
                
                <main className="p-6 space-y-6 overflow-y-auto">
                    {/* Customer & Group Section */}
                    <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="md:col-span-2">
                                <div className="relative">
                                    <InputField 
                                        label="Customer Name"
                                        value={customerSearch}
                                        onChange={(e) => {
                                            setCustomerSearch(e.target.value);
                                            setCustomerName(e.target.value);
                                            setSelectedCustomerId(null);
                                        }}
                                        placeholder="Type to search or add new..."
                                        Icon={User}
                                    />
                                    {customerSuggestions.length > 0 && (
                                        <ul className="absolute z-10 w-full bg-gray-700 border border-gray-600 rounded-lg mt-1 shadow-lg max-h-40 overflow-y-auto">
                                            {customerSuggestions.map(c => (
                                                <li key={c.id} onClick={() => handleSelectCustomer(c)} className="px-4 py-2 hover:bg-gray-600 cursor-pointer">{c.name}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                            <InputField label="Group Size" type="number" value={groupSize} onChange={e => setGroupSize(e.target.value)} Icon={Users} required={true}/>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <InputField 
                                label="Phone Number"
                                type="tel"
                                value={customerDetails.phone}
                                onChange={e => setCustomerDetails(prev => ({...prev, phone: e.target.value}))}
                                placeholder="(123) 456-7890"
                                Icon={Phone}
                            />
                             <InputField 
                                label="Email Address"
                                type="email"
                                value={customerDetails.email}
                                onChange={e => setCustomerDetails(prev => ({...prev, email: e.target.value}))}
                                placeholder="customer@example.com"
                                Icon={Mail}
                            />
                        </div>
                    </div>

                    {/* Booking Items */}
                    <div className="space-y-4">
                        {bookingItems.map((item, index) => (
                            <div key={item.id} className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="font-bold text-lg text-blue-400">Activity #{index + 1}</h3>
                                    {bookingItems.length > 1 && <button onClick={() => handleRemoveItem(item.id)} className="p-1 text-red-400 hover:text-red-300"><Trash2 size={16}/></button>}
                                </div>
                                <BookingItemForm 
                                    item={item} 
                                    onItemChange={handleItemChange}
                                    onResourceToggle={handleItemResourceToggle}
                                    activities={activities}
                                    resources={resources}
                                />
                            </div>
                        ))}
                    </div>
                    <button onClick={handleAddItem} className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold">
                        <PackagePlus size={16} /> Add Activity
                    </button>
                    
                    {/* Add-Ons Section */}
                    <div>
                        <h3 className="text-lg font-semibold mb-3">Add-Ons</h3>
                        <div className="space-y-2">
                            {addOns.map(addOn => {
                                const selected = selectedAddOns.find(a => a.addOnId === addOn.id);
                                return (
                                <div key={addOn.id} className="flex items-center justify-between bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                                    <div className="flex items-center gap-3">
                                        <input type="checkbox" checked={!!selected} onChange={() => handleAddOnToggle(addOn.id)} className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-600"/>
                                        <div>
                                            <p className="font-semibold">{addOn.name}</p>
                                            <p className="text-xs text-gray-400">${addOn.price}/person</p>
                                        </div>
                                    </div>
                                    {selected && (
                                        <div className="flex items-center gap-2">
                                            <label className="text-sm">Qty:</label>
                                            <input type="number" value={selected.quantity} onChange={(e) => handleAddOnQuantityChange(addOn.id, e.target.value)} className="w-20 bg-gray-700 border border-gray-600 rounded-lg p-1 text-center"/>
                                        </div>
                                    )}
                                </div>
                            )})}
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium text-gray-400 mb-1 block">Booking Notes</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add any special requests or notes for this booking..."
                            className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-20 resize-none"
                        />
                    </div>

                    <PaymentSection 
                        booking={{groupSize, items: bookingItems, selectedAddOns, payments}}
                        activities={activities}
                        addOns={addOns}
                        onUpdatePayments={setPayments}
                    />

                </main>

                <footer className="p-4 border-t border-gray-700 flex justify-between items-center bg-gray-800/50 rounded-b-2xl">
                    <div>
                        {booking && (
                             <button onClick={handleDelete} disabled={isSaving} className="text-red-400 hover:text-red-300 font-bold py-2 px-4 rounded-lg flex items-center gap-2 disabled:opacity-50">
                                <Trash2 size={16} /> Delete
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        {modalError && (
                            <div className="p-2 bg-red-500/20 border border-red-500/50 text-red-300 rounded-lg text-sm flex items-center gap-2">
                                <AlertTriangle size={16} />
                                <span>{modalError}</span>
                            </div>
                        )}
                        <button onClick={handleSave} disabled={isSaving || bookingItems.length === 0} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg disabled:bg-gray-500 disabled:cursor-not-allowed">
                            {isSaving ? 'Saving...' : (booking ? 'Update Booking' : 'Create Booking')}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
}

function BookingItemForm({ item, onItemChange, onResourceToggle, activities, resources }) {
    const selectedActivity = activities.find(a => a.id === item.activityId);
    const isFlexi = selectedActivity?.type === 'Flexi Time';

    const handleDateInputChange = (e) => {
        const newDate = new Date(item.startTime);
        const [year, month, day] = e.target.value.split('-').map(Number);
        newDate.setFullYear(year, month - 1, day);
        onItemChange(item.id, 'startTime', newDate);
    };

    const handleTimeInputChange = (part, value) => {
        const newDate = new Date(item.startTime);
        let hours = newDate.getHours();
        
        const isPM = hours >= 12;
        let hour12 = hours % 12;
        if (hour12 === 0) hour12 = 12;

        let newHour12 = part === 'hour' ? parseInt(value) : hour12;
        let newMinute = part === 'minute' ? parseInt(value) : newDate.getMinutes();
        let newPeriod = part === 'period' ? value : (isPM ? 'PM' : 'AM');

        let newHour24 = newHour12;
        if (newPeriod === 'PM' && newHour12 < 12) {
            newHour24 += 12;
        }
        if (newPeriod === 'AM' && newHour12 === 12) {
            newHour24 = 0;
        }

        newDate.setHours(newHour24, newMinute);
        onItemChange(item.id, 'startTime', newDate);
    };

    const dateForInput = item.startTime.toISOString().split('T')[0];
    const currentHour = item.startTime.getHours();
    const currentMinute = item.startTime.getMinutes();
    const currentPeriod = currentHour >= 12 ? 'PM' : 'AM';
    let currentHour12 = currentHour % 12;
    if (currentHour12 === 0) currentHour12 = 12;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                 <div className="md:col-span-2">
                    <label className="text-sm font-medium text-gray-400 mb-1 block">Activity</label>
                    <select value={item.activityId} onChange={(e) => onItemChange(item.id, 'activityId', e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500" required>
                        <option value="" disabled>Select an activity...</option>
                        {activities.map(act => <option key={act.id} value={act.id}>{act.name}</option>)}
                    </select>
                </div>
                <div className="md:col-span-3 grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm font-medium text-gray-400 mb-1 block">Date</label>
                        <input type="date" value={dateForInput} onChange={handleDateInputChange} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                        <div>
                            <label className="text-sm font-medium text-gray-400 mb-1 block">Hr</label>
                            <select value={currentHour12} onChange={(e) => handleTimeInputChange('hour', e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                                {Array.from({length: 12}, (_, i) => i + 1).map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-gray-400 mb-1 block">Min</label>
                            <select value={currentMinute} onChange={(e) => handleTimeInputChange('minute', e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                                {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                            </select>
                        </div>
                        <div>
                           <label className="text-sm font-medium text-gray-400 mb-1 block">&nbsp;</label>
                           <select value={currentPeriod} onChange={(e) => handleTimeInputChange('period', e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                                <option>AM</option>
                                <option>PM</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
             {isFlexi && (
                <div>
                    <label className="text-sm font-medium text-gray-400 mb-1 block">Duration</label>
                    <div className="flex items-center gap-2">
                        <input type="range" min="15" max="180" step="15" value={item.duration} onChange={e => onItemChange(item.id, 'duration', Number(e.target.value))} className="w-full" />
                        <span className="text-sm w-24 text-right">{item.duration} min</span>
                    </div>
                </div>
            )}
             <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">Select Resources</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {item.activityId ? resources.filter(r => r.activityId === item.activityId).map(resource => (
                        <button
                            key={resource.id}
                            onClick={() => onResourceToggle(item.id, resource.id)}
                            className={`p-2 text-xs rounded-lg border-2 text-center ${item.resourceIds.includes(resource.id) ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 hover:border-gray-500'}`}
                        >
                            {resource.name}
                        </button>
                    )) : <p className="text-xs text-gray-500 col-span-full">Please select an activity first.</p>}
                </div>
            </div>
        </div>
    );
}

function CalendarPopup({ selectedDate, setSelectedDate, onClose }) {
    const [date, setDate] = useState(new Date(selectedDate));
    const calendarRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (calendarRef.current && !calendarRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    const daysInMonth = () => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const firstDayOfMonth = () => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

    const changeMonth = (offset) => {
        setDate(prev => {
            const newDate = new Date(prev);
            newDate.setMonth(newDate.getMonth() + offset);
            return newDate;
        });
    };

    const handleDayClick = (day) => {
        const newDate = new Date(date);
        newDate.setDate(day);
        setSelectedDate(newDate);
        onClose();
    };

    const blanks = Array(firstDayOfMonth()).fill(null);
    const days = Array.from({ length: daysInMonth() }, (_, i) => i + 1);

    return (
        <div ref={calendarRef} className="absolute top-full mt-2 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-4 z-50 w-72">
            <div className="flex justify-between items-center mb-2">
                <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-700"><ChevronLeft size={18}/></button>
                <div className="font-bold">{date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
                <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-700"><ChevronRight size={18}/></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-2">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={`${d}-${i}`}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {blanks.map((_, i) => <div key={`blank-${i}`}></div>)}
                {days.map(day => {
                    const isSelected = day === selectedDate.getDate() && date.getMonth() === selectedDate.getMonth() && date.getFullYear() === selectedDate.getFullYear();
                    return (
                        <button 
                            key={day} 
                            onClick={() => handleDayClick(day)}
                            className={`w-9 h-9 rounded-full flex items-center justify-center ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}
                        >
                            {day}
                        </button>
                    )
                })}
            </div>
        </div>
    );
}

function PaymentSection({ booking, activities, addOns, onUpdatePayments }) {
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('Cash');
    const [showPaymentForm, setShowPaymentForm] = useState(false);
    const [editingPaymentId, setEditingPaymentId] = useState(null);

    const { totalPrice, totalPaid, balance, depositRequired } = useMemo(() => {
        const price = calculateBookingPrice(booking, activities, addOns);
        const paid = (booking.payments || []).filter(p => p.status !== 'Refunded').reduce((acc, p) => acc + p.amount, 0);
        
        let deposit = 0;
        if (booking.items && booking.items.length > 0) {
            const mainActivity = activities.find(a => a.id === booking.items[0].activityId);
            if (mainActivity?.requireDeposit) {
                if (mainActivity.depositType === 'Percentage') {
                    deposit = price * (mainActivity.depositValue / 100);
                } else {
                    deposit = mainActivity.depositValue;
                }
            }
        }
        
        return { 
            totalPrice: price, 
            totalPaid: paid, 
            balance: price - paid,
            depositRequired: deposit
        };
    }, [booking, activities, addOns]);

    const handleLogPayment = () => {
        const paidAmount = parseFloat(amount);
        if (isNaN(paidAmount) || paidAmount <= 0) {
            console.error("Invalid payment amount");
            return;
        }

        const newPayment = {
            id: Date.now(),
            amount: paidAmount,
            method: method,
            date: new Date(),
            status: 'Completed'
        };

        onUpdatePayments([...booking.payments, newPayment]);

        if (method === 'Invoice') {
            console.log(`Invoice for $${paidAmount.toFixed(2)} should be generated and emailed.`);
        }
        
        setAmount('');
        setMethod('Cash');
        setShowPaymentForm(false);
    };

    const handleUpdatePayment = (id, updatedAmount, updatedMethod) => {
        const newPayments = booking.payments.map(p => 
            p.id === id ? { ...p, amount: parseFloat(updatedAmount), method: updatedMethod } : p
        );
        onUpdatePayments(newPayments);
        setEditingPaymentId(null);
    };

    const handleToggleRefund = (id) => {
        const newPayments = booking.payments.map(p => {
            if (p.id === id) {
                return { ...p, status: p.status === 'Refunded' ? 'Completed' : 'Refunded' };
            }
            return p;
        });
        onUpdatePayments(newPayments);
    };

    const handleDeletePayment = (id) => {
        const updatedPayments = booking.payments.filter(p => p.id !== id);
        onUpdatePayments(updatedPayments);
    };


    return (
        <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 space-y-4">
            <h3 className="text-lg font-semibold mb-2">Payments</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div className="bg-gray-800 p-3 rounded-lg">
                    <p className="text-xs text-gray-400">Total Price</p>
                    <p className="text-lg font-bold">${totalPrice.toFixed(2)}</p>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg">
                    <p className="text-xs text-gray-400">Deposit Required</p>
                    <p className="text-lg font-bold text-orange-400">${depositRequired.toFixed(2)}</p>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg">
                    <p className="text-xs text-gray-400">Total Paid</p>
                    <p className="text-lg font-bold text-green-400">${totalPaid.toFixed(2)}</p>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg">
                    <p className="text-xs text-gray-400">Balance Due</p>
                    <p className="text-lg font-bold text-red-400">${balance.toFixed(2)}</p>
                </div>
            </div>

            {booking.payments.length > 0 && (
                <div>
                    <h4 className="text-sm font-semibold text-gray-300 mb-2">Payment History</h4>
                    <ul className="space-y-1 text-sm text-gray-400">
                        {booking.payments.map((p) => (
                            <PaymentHistoryItem 
                                key={p.id} 
                                payment={p}
                                onUpdate={handleUpdatePayment}
                                onToggleRefund={handleToggleRefund}
                                onDelete={handleDeletePayment}
                                editing={editingPaymentId === p.id}
                                onSetEditing={setEditingPaymentId}
                            />
                        ))}
                    </ul>
                </div>
            )}

            {!showPaymentForm && (
                <button onClick={() => setShowPaymentForm(true)} className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold">
                    <Plus size={16} /> Log a Payment
                </button>
            )}

            {showPaymentForm && (
                <div className="bg-gray-800 p-4 rounded-lg border border-gray-600 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <InputField label="Amount Paid" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" Icon={DollarSign} />
                        <div>
                            <label className="text-sm font-medium text-gray-400 mb-1 block">Payment Method</label>
                            <select value={method} onChange={e => setMethod(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2.5 text-white">
                                <option>Cash</option>
                                <option>POS Card</option>
                                <option>Invoice</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setShowPaymentForm(false)} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg">Cancel</button>
                        <button onClick={handleLogPayment} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">Log Payment</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function PaymentHistoryItem({ payment, onUpdate, onToggleRefund, onDelete, editing, onSetEditing }) {
    const [editAmount, setEditAmount] = useState(payment.amount);
    const [editMethod, setEditMethod] = useState(payment.method);

    const handleSave = () => {
        onUpdate(payment.id, editAmount, editMethod);
    };

    if (editing) {
        return (
             <li className="flex justify-between items-center bg-gray-800 p-2 rounded-md gap-2">
                <input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="w-24 bg-gray-700 border border-gray-600 rounded-lg p-1 text-center"/>
                <select value={editMethod} onChange={e => setEditMethod(e.target.value)} className="flex-grow bg-gray-700 border border-gray-600 rounded-lg p-1">
                    <option>Cash</option>
                    <option>POS Card</option>
                    <option>Invoice</option>
                </select>
                <div className="flex items-center gap-1">
                    <button onClick={handleSave} className="p-1.5 hover:bg-gray-700 rounded-md text-green-400"><Check size={16} /></button>
                    <button onClick={() => onSetEditing(null)} className="p-1.5 hover:bg-gray-700 rounded-md text-gray-400"><X size={16} /></button>
                </div>
            </li>
        )
    }

    return (
        <li className={`flex justify-between items-center bg-gray-800/50 p-2 rounded-md ${payment.status === 'Refunded' ? 'opacity-50' : ''}`}>
            <div>
                <span className={payment.status === 'Refunded' ? 'line-through' : ''}>
                    {payment.method} payment on {payment.date.toLocaleDateString()}
                </span>
                {payment.status === 'Refunded' && <span className="text-xs text-red-400 ml-2">(Refunded)</span>}
            </div>
            <div className="flex items-center gap-1">
                <span className={`font-semibold text-gray-200 ${payment.status === 'Refunded' ? 'line-through' : ''}`}>${payment.amount.toFixed(2)}</span>
                <button onClick={() => onSetEditing(payment.id)} className="p-1.5 hover:bg-gray-700 rounded-md text-gray-400" title="Edit Payment"><Edit size={14} /></button>
                <button onClick={() => onToggleRefund(payment.id)} className="p-1.5 hover:bg-gray-700 rounded-md text-orange-400" title={payment.status === 'Refunded' ? 'Mark as Not Refunded' : 'Mark as Refunded'}>
                    <RotateCcw size={14} />
                </button>
                <button onClick={() => onDelete(payment.id)} className="p-1.5 hover:bg-gray-700 rounded-md text-red-400" title="Delete Payment">
                    <Trash2 size={14} />
                </button>
            </div>
        </li>
    );
}

// --- Reusable Input Field Component (Updated for Checkbox) ---
function InputField({ label, type = 'text', value, onChange, placeholder, Icon, required = false, maxLength, className = '', checked }) {
    if (type === 'checkbox') {
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={onChange}
                    id={label}
                    className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-600"
                />
                {label && <label htmlFor={label} className="text-sm font-medium text-gray-300">{label}</label>}
            </div>
        );
    }
    
    return (
        <div className={className}>
            {label && <label className="text-sm font-medium text-gray-400 mb-1 block">{label}</label>}
            <div className="relative">
                {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />}
                <input
                    type={type}
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    className={`w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${Icon ? 'pl-10' : 'pl-3'}`}
                    required={required}
                    maxLength={maxLength}
                    step={type === 'time' ? 900 : (type === 'number' ? 'any' : undefined)}
                />
            </div>
        </div>
    );
}
