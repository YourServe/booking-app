import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { 
    getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, 
    onSnapshot, collection, query, where, getDocs, writeBatch, serverTimestamp, Timestamp 
} from 'firebase/firestore';
import { Calendar, Settings, X, Plus, Trash2, MoreVertical, Check, User, Users, Clock, Tag, DollarSign, GripVertical, Search, Phone, Mail, PackagePlus, ChevronLeft, ChevronRight, CaseUpper, FileText, ShoppingCart, GlassWater, Pizza, Gift, Ticket, Link2, MapPin } from 'lucide-react';

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
        const collections = ['activities', 'resources', 'bookings', 'customers', 'addOns', 'resourceLinks', 'areas'];
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
                            }))
                        }));
                        setBookings(parsedBookings); 
                        break;
                    case 'customers': setCustomers(data); break;
                    case 'addOns': setAddOns(data.sort((a, b) => a.name.localeCompare(b.name))); break;
                    case 'resourceLinks': setResourceLinks(data); break;
                    case 'areas': setAreas(data.sort((a, b) => a.name.localeCompare(b.name))); break;
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

    return (
        <div className="bg-gray-900 text-gray-200 font-sans min-h-screen flex flex-col">
            <header className="bg-gray-900/80 backdrop-blur-md border-b border-gray-700 p-3 flex justify-between items-center sticky top-0 z-50">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                        <Calendar size={18} className="text-white"/>
                    </div>
                    <h1 className="text-xl font-bold text-white">Venue Booking</h1>
                </div>

                {view === 'timeline' && (
                    <div className="flex-grow flex justify-center items-center relative">
                        <div className="flex items-center gap-2">
                            <button onClick={() => handleDateChange(-1)} className="p-2 rounded-md hover:bg-gray-700"><ChevronLeft size={20}/></button>
                            <button onClick={() => setShowCalendar(c => !c)} className="text-lg font-semibold hover:bg-gray-700 px-3 py-1 rounded-md">
                                {selectedDate.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                            </button>
                            <button onClick={() => handleDateChange(1)} className="p-2 rounded-md hover:bg-gray-700"><ChevronRight size={20}/></button>
                            {showCalendar && <CalendarPopup selectedDate={selectedDate} setSelectedDate={setSelectedDate} onClose={() => setShowCalendar(false)} />}
                        </div>
                    </div>
                )}

                <nav className="flex items-center gap-4">
                     {view === 'timeline' && (
                        <>
                            <button onClick={() => setSelectedDate(new Date())} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-semibold">
                                Today
                            </button>
                            <button
                                onClick={() => handleOpenBookingModal(null, selectedDate)}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-semibold"
                            >
                                <Plus size={16} /> New
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
                                activities={activities}
                                resources={resources}
                                bookings={bookings}
                                addOns={addOns}
                                resourceLinks={resourceLinks}
                                areas={areas}
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
                />
            )}
        </div>
    );
}

// --- Timeline View Component ---
function TimelineView({ activities, resources, bookings, addOns, resourceLinks, areas, onNewBooking, selectedDate }) {
    const db = getFirestore();
    const appId = 'default-app-id'; // Use consistent ID
    
    const timelineBodyRef = useRef(null);
    const leftColumnRef = useRef(null);
    const timeHeaderRef = useRef(null);
    const [nowLinePos, setNowLinePos] = useState(null);

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
        const timer = setInterval(calculateNowLine, 60000); // Update every minute
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
        const width = `calc(${(item.duration / 15)} * 4rem)`;

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
    
    const headerHeight = `h-[${ROW_HEIGHT_REM}rem]`;
    const rowHeightClass = `h-10`; // 40px

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

                const activeLinkGroupsInInterval = new Set();
                const bookedResourcesInInterval = new Set();

                filteredBookings.forEach(booking => {
                    booking.items.forEach(item => {
                        const activity = activities.find(a => a.id === item.activityId);
                        if (activity && activity.areaId === area.id) {
                            const itemEnd = new Date(item.startTime.getTime() + item.duration * 60 * 1000);
                            if (item.startTime < interval.end && itemEnd > interval.start) {
                                item.resourceIds.forEach(resId => {
                                    bookedResourcesInInterval.add(resId);
                                    const group = resourceLinks.find(g => g.resourceIds.includes(resId));
                                    if (group) {
                                        activeLinkGroupsInInterval.add(group.id);
                                    } else {
                                        activeLinkGroupsInInterval.add(resId);
                                    }
                                });
                            }
                        }
                    });
                });
                
                const staffUsed = activeLinkGroupsInInterval.size;

                if (staffUsed >= staffAvailable) {
                    const resourcesInArea = resources.filter(r => {
                        const activity = activities.find(a => a.id === r.activityId);
                        return activity && activity.areaId === area.id;
                    });
                    
                    resourcesInArea.forEach(resource => {
                        if (bookedResourcesInInterval.has(resource.id)) return;

                        const linkGroupOfResource = resourceLinks.find(g => g.resourceIds.includes(resource.id));
                        
                        if (linkGroupOfResource) {
                            if (!activeLinkGroupsInInterval.has(linkGroupOfResource.id)) {
                                 const slotIdentifier = `${interval.start.getTime()}-${resource.id}`;
                                 if (!addedSlots.has(slotIdentifier)) {
                                    slots.push({ id: `unavailable-${slotIdentifier}`, resourceId: resource.id, startTime: interval.start, duration: 15 });
                                    addedSlots.add(slotIdentifier);
                                 }
                            }
                        } else { 
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
            <div className="w-[140px] flex-shrink-0 z-20 bg-gray-800 border-r border-gray-700 flex flex-col">
                <div className={`flex-shrink-0 border-b border-gray-700 ${headerHeight}`}></div>
                <div ref={leftColumnRef} className="overflow-y-hidden">
                    {groupedResources.map(activity => (
                        <div key={activity.id}>
                            <div className="h-8 flex items-center px-4 bg-gray-700 border-b border-t border-gray-600">
                                <h3 className="text-sm font-bold text-blue-400">{activity.name}</h3>
                            </div>
                            {activity.resources.map(resource => (
                                <div key={resource.id} className={`flex items-center px-4 border-b border-gray-700 ${rowHeightClass}`}>
                                    <span className="text-gray-300 truncate">{resource.abbreviation || resource.name}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
            <div ref={timelineBodyRef} className="flex-grow overflow-auto">
                <div className="relative min-w-max">
                    <div ref={timeHeaderRef} className={`flex sticky top-0 z-10 bg-gray-900/80 backdrop-blur-sm border-b border-gray-700 ${headerHeight}`}>
                        {timeSlots.slice(0, -1).map(time => (
                            <div key={time} className={`w-16 flex-shrink-0 text-center text-xs text-gray-400 flex items-center justify-center border-r border-gray-700`}>
                                {time.endsWith(':00') ? <strong>{time}</strong> : <span className="text-gray-600">·</span>}
                            </div>
                        ))}
                    </div>

                    {groupedResources.map(activity => (
                        <div key={activity.id}>
                            <div className="h-8 border-b border-gray-600"></div>
                            {activity.resources.map(resource => (
                                <div key={resource.id} className={`relative flex border-b border-gray-700 ${rowHeightClass}`}>
                                    {timeSlots.slice(0, -1).map((time, i) => (
                                        <div
                                            key={i}
                                            className={`w-16 h-full flex-shrink-0 border-r ${i % 4 === 3 ? 'border-gray-600' : 'border-gray-700'} hover:bg-blue-500/10 cursor-pointer`}
                                            onClick={() => onNewBooking(null, new Date(selectedDate.setHours(parseInt(time.split(':')[0]), parseInt(time.split(':')[1]), 0, 0)), resource.id)}
                                        ></div>
                                    ))}
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
                                                                {booking.notes && <FileText size={12} className="text-gray-200" title={booking.notes} />}
                                                                {booking.selectedAddOns && booking.selectedAddOns.map(sa => {
                                                                    const addOn = addOns.find(a => a.id === sa.addOnId);
                                                                    return addOn ? <AddOnIcon key={addOn.id} name={addOn.iconName} size={12} className="text-gray-200" title={`${addOn.name} (x${sa.quantity})`} /> : null;
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
function SettingsView({ db, appId, activities, resources, addOns, resourceLinks, areas }) {
    const [currentTab, setCurrentTab] = useState('activities');

    return (
        <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-white">Settings</h1>
                <p className="text-gray-400 mt-1">Manage activities and resources for your venue.</p>
            </div>
            <div className="flex border-b border-gray-700 mb-6">
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
            </div>
            <div>
                {currentTab === 'activities' && <ActivityManager db={db} appId={appId} activities={activities} areas={areas} />}
                {currentTab === 'resources' && <ResourceManager db={db} appId={appId} resources={resources} activities={activities} />}
                {currentTab === 'addOns' && <AddOnManager db={db} appId={appId} addOns={addOns} />}
                {currentTab === 'linking' && <ResourceLinkManager db={db} appId={appId} resources={resources} activities={activities} resourceLinks={resourceLinks} />}
                {currentTab === 'schedule' && <AreaManager db={db} appId={appId} areas={areas} />}
            </div>
        </div>
    );
}

// --- Activity Manager Component ---
function ActivityManager({ db, appId, activities, areas }) {
    const [name, setName] = useState('');
    const [type, setType] = useState('Fixed Time');
    const [price, setPrice] = useState('');
    const [areaId, setAreaId] = useState('');
    const [editingId, setEditingId] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name || !price || !areaId) return;
        const collectionRef = collection(db, `artifacts/${appId}/public/data/activities`);
        const data = { name, type, price: Number(price), areaId };

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
            alert("Please select at least two resources to link.");
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
    const [name, setName] = useState('');
    const [schedule, setSchedule] = useState(DAYS_OF_WEEK.map(day => ({ day, isOpen: true, staffBlocks: [{id: 1, start: '09:00', end: '22:00', count: 1}] })));
    const [editingId, setEditingId] = useState(null);

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
        setSchedule(area.schedule || DAYS_OF_WEEK.map(day => ({ day, isOpen: true, staffBlocks: [{id: 1, start: '09:00', end: '22:00', count: 1}] })));
    };

    const handleDelete = async (id) => {
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/areas`, id));
    };

    const resetForm = () => {
        setName('');
        setSchedule(DAYS_OF_WEEK.map(day => ({ day, isOpen: true, staffBlocks: [{id: 1, start: '09:00', end: '22:00', count: 1}] })));
        setEditingId(null);
    };

    return (
        <div className="grid md:grid-cols-2 gap-8">
            <div>
                <h3 className="text-xl font-semibold mb-4">{editingId ? 'Edit Area' : 'Add New Area'}</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <InputField label="Area Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Main Floor" Icon={MapPin} required={true} />
                    <div className="space-y-4">
                        {schedule.map(({ day, isOpen, staffBlocks }) => (
                            <div key={day} className="bg-gray-800 p-3 rounded-lg">
                                <label className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-2">
                                    <input type="checkbox" checked={isOpen} onChange={(e) => handleScheduleChange(day, 'isOpen', e.target.checked)} className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-600"/>
                                    {day}
                                </label>
                                {isOpen && (
                                    <div className="space-y-2 pl-6">
                                        {staffBlocks.map((block, index) => (
                                            <div key={block.id || index} className="grid grid-cols-4 gap-2 items-center">
                                                <InputField type="time" value={block.start} onChange={(e) => handleBlockChange(day, block.id, 'start', e.target.value)} required={true}/>
                                                <InputField type="time" value={block.end} onChange={(e) => handleBlockChange(day, block.id, 'end', e.target.value)} required={true}/>
                                                <InputField type="number" value={block.count} onChange={(e) => handleBlockChange(day, block.id, 'count', e.target.value)} required={true} placeholder="Staff"/>
                                                <button type="button" onClick={() => removeBlock(day, block.id)} className="p-2 text-red-400 hover:bg-gray-700 rounded-md"><Trash2 size={16}/></button>
                                            </div>
                                        ))}
                                        <button type="button" onClick={() => addBlock(day)} className="text-xs text-blue-400 hover:underline">+ Add Time Block</button>
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


// --- Booking Modal Component ---
function BookingModal({ isOpen, onClose, db, appId, booking, initialData, activities, resources, customers, addOns, resourceLinks, bookings, selectedDate }) {
    const [customerName, setCustomerName] = useState('');
    const [customerDetails, setCustomerDetails] = useState({ phone: '', email: '' });
    const [groupSize, setGroupSize] = useState(2);
    const [bookingItems, setBookingItems] = useState([]);
    const [notes, setNotes] = useState('');
    const [selectedAddOns, setSelectedAddOns] = useState([]);

    const [customerSearch, setCustomerSearch] = useState('');
    const [customerSuggestions, setCustomerSuggestions] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);

    const resetModalState = useCallback(() => {
        const defaultStartTime = new Date(selectedDate);
        defaultStartTime.setHours(12, 0, 0, 0); // Default to noon on the selected date
        
        setCustomerName('');
        setCustomerDetails({ phone: '', email: '' });
        setGroupSize(2);
        setBookingItems(initialData.items || [{ id: Date.now(), activityId: '', resourceIds: [], startTime: defaultStartTime, duration: 60 }]);
        setNotes('');
        setSelectedAddOns([]);
        setCustomerSearch('');
        setCustomerSuggestions([]);
        setSelectedCustomerId(null);
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
            } else {
                 resetModalState();
            }
        }
    }, [booking, isOpen, customers, resetModalState]);

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

    const calculatePrice = useCallback(() => {
        const numGroupSize = Number(groupSize) || 0;
        if (numGroupSize < 1) return 0;

        const activitiesTotal = bookingItems.reduce((acc, item) => {
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
    }, [bookingItems, activities, groupSize, selectedAddOns, addOns]);

    const handleSave = async () => {
        if (bookingItems.some(item => !item.activityId || item.resourceIds.length === 0) || isSaving) {
            alert("Please select an activity and at least one resource for each item.");
            return;
        }
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
            totalPrice: calculatePrice(),
            items: finalBookingItems,
            notes: notes.trim(),
            selectedAddOns: selectedAddOns,
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
            alert("Failed to save booking.");
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
            alert("Failed to delete booking.");
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
            <div className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
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
                </main>

                <footer className="p-4 border-t border-gray-700 flex justify-between items-center bg-gray-800/50 rounded-b-2xl">
                    <div>
                        {booking && (
                             <button onClick={handleDelete} disabled={isSaving} className="text-red-400 hover:text-red-300 font-bold py-2 px-4 rounded-lg flex items-center gap-2 disabled:opacity-50">
                                <Trash2 size={16} /> Delete
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-4">
                        <PriceBreakdown 
                            bookingItems={bookingItems}
                            selectedAddOns={selectedAddOns}
                            groupSize={groupSize}
                            activities={activities}
                            addOns={addOns}
                            totalPrice={calculatePrice()}
                        />
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

function PriceBreakdown({ bookingItems, selectedAddOns, groupSize, activities, addOns, totalPrice }) {
    const numGroupSize = Number(groupSize) || 0;

    const activityCosts = bookingItems.map(item => {
        const activity = activities.find(a => a.id === item.activityId);
        if (!activity) return null;
        let price = 0;
        if (activity.type === 'Fixed Time') {
            price = activity.price;
        } else {
            price = (activity.price / 15) * item.duration;
        }
        return { name: activity.name, total: price * numGroupSize };
    }).filter(Boolean);

    const addOnCosts = selectedAddOns.map(selected => {
        const addOn = addOns.find(a => a.id === selected.addOnId);
        if (!addOn) return null;
        return { name: addOn.name, total: addOn.price * selected.quantity };
    }).filter(Boolean);

    return (
        <div className="relative group">
            <span className="text-lg font-bold">Total: ${totalPrice}</span>
            <div className="absolute bottom-full right-0 mb-2 w-72 bg-gray-700 border border-gray-600 rounded-lg shadow-lg p-3 text-sm text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-10">
                <div className="font-bold mb-2">Price Breakdown</div>
                <div className="space-y-1">
                    {activityCosts.map((item, i) => (
                        <div key={`act-${i}`} className="flex justify-between">
                            <span>{item.name} (x{numGroupSize})</span>
                            <span>${item.total}</span>
                        </div>
                    ))}
                    {addOnCosts.map((item, i) => (
                         <div key={`add-${i}`} className="flex justify-between">
                            <span>{item.name}</span>
                            <span>${item.total}</span>
                        </div>
                    ))}
                </div>
                <div className="border-t border-gray-500 mt-2 pt-2 flex justify-between font-bold">
                    <span>Total</span>
                    <span>${totalPrice}</span>
                </div>
            </div>
        </div>
    );
}

// --- Reusable Input Field Component ---
function InputField({ label, type = 'text', value, onChange, placeholder, Icon, required = false, maxLength }) {
    return (
        <div>
            <label className="text-sm font-medium text-gray-400 mb-1 block">{label}</label>
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
                />
            </div>
        </div>
    );
}
