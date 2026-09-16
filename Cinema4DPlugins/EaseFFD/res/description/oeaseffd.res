// Attribute Manager layout for the Ease FFD deformer.
// Container name (Oeaseffd) MUST match the "description" argument
// passed to RegisterObjectPlugin() in EaseFFD.pyp.

CONTAINER Oeaseffd
{
    INCLUDE Obase;

    NAME Oeaseffd;

    GROUP ID_OBJECTPROPERTIES
    {
        LINK EASEFFD_CAGE
        {
            // Only accept native FFD objects in this slot.
            ACCEPT { Offd; }
        }
        REAL EASEFFD_EASE
        {
            UNIT PERCENT;
            MIN 0.0;
            MAXSLIDER 3.0;
            STEP 0.01;
        }
    }
}
